import { Inject, Injectable } from '@nestjs/common';
import {
  type PlatformInvoiceDto,
  type PlatformPaymentMethod,
  billingDate,
  periodsToInvoice,
  subscriptionCharge,
} from '@app/shared';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { BILLING_PROVIDER, type BillingProvider } from './billing-provider.js';
import { BillingAccessService } from './billing-access.service.js';
import { CustomersService } from './customers.service.js';
import { PlatformAuditAction, PlatformAuditService } from './platform-audit.service.js';
import { toInvoiceDto } from './platform-directory.service.js';
import type { PlatformActor } from './platform.keys.js';

const STALE =
  'Esta cobrança foi alterada por outra pessoa. Os dados foram atualizados; confira e tente de novo.';

/**
 * Platform invoices, manual control (D042): generate the period's invoices (idempotent: one per
 * subscription and period), mark as paid (unblocks right away) or cancel (waived). A billing
 * provider (Asaas, Mercado Pago, Pagar.me) plugs in through BillingProvider later.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: PlatformAuditService,
    private readonly billing: BillingAccessService,
    private readonly customers: CustomersService,
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
  ) {}

  async list(query: { status?: string; organizationId?: string }): Promise<PlatformInvoiceDto[]> {
    const settings = await this.billing.settings();
    const today = billingDate(new Date());
    const where: Prisma.PlatformInvoiceWhereInput = { organizationId: query.organizationId };
    if (query.status === 'PAID' || query.status === 'CANCELED') where.status = query.status;
    if (query.status === 'OPEN' || query.status === 'DUE_SOON' || query.status === 'OVERDUE') {
      where.status = 'OPEN';
    }
    if (query.status === 'OVERDUE') where.dueDate = { lt: today };
    const invoices = await this.prisma.platformInvoice.findMany({
      where,
      include: { organization: { select: { name: true } } },
      orderBy: [{ dueDate: query.status === 'PAID' ? 'desc' : 'asc' }, { seq: 'asc' }],
      take: 500,
    });
    const dtos = invoices.map((i) => toInvoiceDto(i, today, settings.warnDaysBefore));
    return query.status === 'DUE_SOON' ? dtos.filter((d) => d.displayStatus === 'DUE_SOON') : dtos;
  }

  /** Creates the missing invoices of every active subscription (or one customer) due soon. */
  async generate(organizationId: string | null | undefined, actor: PlatformActor) {
    const today = billingDate(new Date());
    const subscriptions = await this.prisma.subscription.findMany({
      where: { organizationId: organizationId ?? undefined },
      include: {
        plan: true,
        organization: { include: { stores: { where: { isActive: true }, select: { id: true } } } },
        invoices: { select: { periodStart: true } },
      },
    });
    const created: string[] = [];
    for (const s of subscriptions) {
      const periods = periodsToInvoice(
        { billingStart: s.billingStart, interval: s.interval },
        {
          today,
          billedStarts: new Set(s.invoices.map((i) => i.periodStart)),
          endsOn: s.canceledAt ? billingDate(s.canceledAt) : null,
        },
      );
      for (const period of periods) {
        const charge = subscriptionCharge(
          {
            priceCents: s.priceCents,
            storeLimit: s.plan.storeLimit,
            extraStorePriceCents: s.plan.extraStorePriceCents,
          },
          s.organization.stores.length,
        );
        try {
          const invoice = await this.prisma.$transaction(async (tx) => {
            const inv = await tx.platformInvoice.create({
              data: {
                organizationId: s.organizationId,
                subscriptionId: s.id,
                ...period,
                amountCents: charge.totalCents,
                details: { ...charge, planName: s.plan.name },
                provider: this.provider.name,
                createdById: actor.adminId,
              },
            });
            await this.audit.log(
              {
                action: PlatformAuditAction.INVOICES_GENERATED,
                entity: 'PlatformInvoice',
                entityId: inv.id,
                organizationId: s.organizationId,
                after: { ...period, amountCents: charge.totalCents },
              },
              actor,
              tx,
            );
            return inv;
          });
          const remote = await this.provider.createCharge(
            {
              organizationId: s.organizationId,
              name: s.organization.legalName ?? s.organization.name,
              document: s.organization.document,
              email: s.organization.invoiceEmail,
            },
            {
              invoiceId: invoice.id,
              amountCents: invoice.amountCents,
              dueDate: invoice.dueDate,
              description: `${s.plan.name} — ${period.periodStart} a ${period.periodEnd}`,
            },
          );
          if (remote) {
            await this.prisma.platformInvoice.update({
              where: { id: invoice.id },
              data: { providerRef: remote.providerRef, providerUrl: remote.providerUrl },
            });
          }
          created.push(invoice.id);
        } catch (error) {
          // Generated at the same time by someone else: the unique period wins, nothing doubles.
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
            continue;
          throw error;
        }
      }
      if (periods.length) await this.customers.notify(s.organizationId);
    }
    return { created: created.length };
  }

  async markPaid(
    id: string,
    input: {
      expectedVersion: number;
      paidOn: string;
      paymentMethod: PlatformPaymentMethod;
      note: string | null;
    },
    actor: PlatformActor,
  ): Promise<PlatformInvoiceDto> {
    const invoice = await this.find(id);
    if (invoice.status !== 'OPEN')
      throw new ValidationError('Só cobranças em aberto podem ser pagas');
    if (input.paidOn > billingDate(new Date())) {
      throw new ValidationError('A data do pagamento não pode ser futura');
    }
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.platformInvoice.updateMany({
        where: { id, version: input.expectedVersion, status: 'OPEN' },
        data: {
          status: 'PAID',
          paidOn: input.paidOn,
          paidAt: new Date(),
          paymentMethod: input.paymentMethod,
          paymentNote: input.note,
          version: { increment: 1 },
        },
      });
      if (!updated.count) throw new ConflictError(STALE);
      await this.audit.log(
        {
          action: PlatformAuditAction.INVOICE_PAID,
          entity: 'PlatformInvoice',
          entityId: id,
          organizationId: invoice.organizationId,
          after: {
            paidOn: input.paidOn,
            method: input.paymentMethod,
            note: input.note,
            amountCents: invoice.amountCents,
          },
        },
        actor,
        tx,
      );
    });
    // Unblocks right away (D042): caches dropped and banners refreshed.
    await this.customers.notify(invoice.organizationId);
    return this.dto(id);
  }

  async cancel(
    id: string,
    input: { expectedVersion: number; reason: string },
    actor: PlatformActor,
  ) {
    const invoice = await this.find(id);
    if (invoice.status !== 'OPEN')
      throw new ValidationError('Só cobranças em aberto podem ser canceladas');
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.platformInvoice.updateMany({
        where: { id, version: input.expectedVersion, status: 'OPEN' },
        data: {
          status: 'CANCELED',
          canceledAt: new Date(),
          cancelReason: input.reason,
          version: { increment: 1 },
        },
      });
      if (!updated.count) throw new ConflictError(STALE);
      await this.audit.log(
        {
          action: PlatformAuditAction.INVOICE_CANCELED,
          entity: 'PlatformInvoice',
          entityId: id,
          organizationId: invoice.organizationId,
          reason: input.reason,
          before: { amountCents: invoice.amountCents, dueDate: invoice.dueDate },
        },
        actor,
        tx,
      );
    });
    if (invoice.providerRef) await this.provider.cancelCharge(invoice.providerRef);
    await this.customers.notify(invoice.organizationId);
    return this.dto(id);
  }

  private async find(id: string) {
    const invoice = await this.prisma.platformInvoice.findUnique({ where: { id } });
    if (!invoice) throw new NotFoundError('Cobrança');
    return invoice;
  }

  private async dto(id: string): Promise<PlatformInvoiceDto> {
    const invoice = await this.prisma.platformInvoice.findUniqueOrThrow({
      where: { id },
      include: { organization: { select: { name: true } } },
    });
    const settings = await this.billing.settings();
    return toInvoiceDto(invoice, billingDate(new Date()), settings.warnDaysBefore);
  }
}
