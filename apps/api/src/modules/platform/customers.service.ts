import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
  type CustomerDetailDto,
  addDaysToDate,
  billingDate,
  createCustomerSchema,
  customerDataSchema,
} from '@app/shared';
import type { z } from 'zod';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { AuthService, DEFAULT_HOURS, UNUSABLE_PASSWORD } from '../auth/auth.service.js';
import { MenuRevalidationService } from '../digital-menu/menu-revalidation.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { BillingAccessService } from './billing-access.service.js';
import { PlatformAuditAction, PlatformAuditService } from './platform-audit.service.js';
import { PlatformDirectoryService } from './platform-directory.service.js';
import type { PlatformActor } from './platform.keys.js';

type CustomerData = z.output<typeof customerDataSchema>;
type CreateCustomerData = z.output<typeof createCustomerSchema>;

/** Cuid-like id generated before the transaction (the new store is also the tenant id). */
const newId = () => `c${Date.now().toString(36)}${randomBytes(8).toString('hex')}`;

const organizationData = (c: CustomerData) => ({
  name: c.name,
  documentType: c.document.length === 11 ? ('CPF' as const) : ('CNPJ' as const),
  document: c.document,
  legalName: c.legalName,
  municipalRegistration: c.municipalRegistration,
  invoiceEmail: c.invoiceEmail,
  contactName: c.contactName,
  contactEmail: c.contactEmail ?? null,
  contactPhone: c.contactPhone,
  addressCep: c.address.cep,
  addressStreet: c.address.street,
  addressNumber: c.address.number,
  addressComplement: c.address.complement || null,
  addressNeighborhood: c.address.neighborhood,
  addressCity: c.address.city,
  addressState: c.address.state,
  notes: c.notes,
});

/**
 * Customers (organizations) managed by the platform admin (D041). Creating a customer mirrors
 * the public signup: organization, first store (default hours), owner and subscription in one
 * transaction with explicit tenant ids; the owner gets the invitation after the commit.
 */
@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: PlatformAuditService,
    private readonly directory: PlatformDirectoryService,
    private readonly billing: BillingAccessService,
    private readonly realtime: RealtimeService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async create(input: CreateCustomerData, actor: PlatformActor): Promise<CustomerDetailDto> {
    const plan = await this.prisma.plan.findFirst({
      where: { id: input.subscription.planId, isActive: true },
    });
    if (!plan) throw new ValidationError('Plano não encontrado ou inativo');

    let slug = input.store.slug;
    if (slug) {
      if (await this.prisma.store.findUnique({ where: { slug } })) {
        throw new ConflictError('Esse endereço do cardápio já está em uso');
      }
    } else {
      slug = await this.auth.availableSlug(input.store.tradeName);
    }

    const ownerEmail = input.owner.email;
    const existing = await this.prisma.user.findUnique({ where: { email: ownerEmail } });
    const today = billingDate(new Date());
    const start = input.subscription.startDate ?? today;
    const trialDays = input.subscription.trialDays ?? plan.trialDays;
    const trialEndsOn = trialDays > 0 ? addDaysToDate(start, trialDays) : null;
    const priceCents = input.subscription.priceCents ?? plan.priceCents;
    const storeId = newId();

    const { organizationId, ownerId } = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { ...organizationData(input.customer), createdVia: 'ADMIN' },
      });
      await tx.store.create({
        data: {
          id: storeId,
          organizationId: org.id,
          slug,
          tradeName: input.store.tradeName,
          legalName: input.customer.legalName,
          cnpj: input.store.cnpj,
          phone: input.store.phone,
          email: ownerEmail,
          businessHours: { createMany: { data: DEFAULT_HOURS } },
        },
      });
      let ownerId: string;
      if (existing) {
        await tx.membership.create({
          data: { tenantId: storeId, userId: existing.id, role: 'OWNER' },
        });
        ownerId = existing.id;
      } else {
        const user = await tx.user.create({
          data: {
            name: input.owner.name,
            email: ownerEmail,
            phone: input.owner.phone ?? null,
            passwordHash: UNUSABLE_PASSWORD,
            lastStoreId: storeId,
            memberships: { create: { tenantId: storeId, role: 'OWNER' } },
          },
        });
        ownerId = user.id;
      }
      const subscription = await tx.subscription.create({
        data: {
          organizationId: org.id,
          planId: plan.id,
          priceCents,
          interval: plan.interval,
          startedAt: new Date(),
          trialEndsOn,
          billingStart: trialEndsOn ?? start,
        },
      });
      await tx.subscriptionChange.create({
        data: {
          subscriptionId: subscription.id,
          kind: 'CREATED',
          toPlanId: plan.id,
          after: { priceCents, trialEndsOn, billingStart: subscription.billingStart },
          adminId: actor.adminId,
        },
      });
      await this.audit.log(
        {
          action: PlatformAuditAction.CUSTOMER_CREATED,
          entity: 'Organization',
          entityId: org.id,
          organizationId: org.id,
          storeId,
          after: {
            customer: input.customer.name,
            store: input.store.tradeName,
            slug,
            owner: ownerEmail,
            plan: plan.name,
            priceCents,
            trialEndsOn,
          },
        },
        actor,
        tx,
      );
      return { organizationId: org.id, ownerId };
    });

    if (!existing) await this.invite(organizationId, ownerId, actor);
    return this.directory.customerDetail(organizationId);
  }

  async update(id: string, input: CustomerData, actor: PlatformActor): Promise<CustomerDetailDto> {
    const before = await this.prisma.organization.findUnique({ where: { id } });
    if (!before) throw new NotFoundError('Cliente');
    await this.prisma.$transaction(async (tx) => {
      const after = await tx.organization.update({ where: { id }, data: organizationData(input) });
      await this.audit.log(
        {
          action: PlatformAuditAction.CUSTOMER_UPDATED,
          entity: 'Organization',
          entityId: id,
          organizationId: id,
          before,
          after,
        },
        actor,
        tx,
      );
    });
    return this.directory.customerDetail(id);
  }

  /** Disabling blocks every user of the organization at the next request/refresh. */
  async setActive(id: string, active: boolean, reason: string, actor: PlatformActor) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      include: { stores: true },
    });
    if (!org) throw new NotFoundError('Cliente');
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id }, data: { isActive: active } });
      if (!active) {
        // Sessions of users that only belong to this organization end now.
        const memberships = await tx.membership.findMany({
          where: { tenantId: { in: org.stores.map((s) => s.id) } },
          select: { userId: true },
        });
        await tx.refreshToken.updateMany({
          where: { userId: { in: memberships.map((m) => m.userId) }, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await this.audit.log(
        {
          action: active
            ? PlatformAuditAction.CUSTOMER_ENABLED
            : PlatformAuditAction.CUSTOMER_DISABLED,
          entity: 'Organization',
          entityId: id,
          organizationId: id,
          reason,
        },
        actor,
        tx,
      );
    });
    return this.directory.customerDetail(id);
  }

  /** (Re)sends the invitation of a user who has not set a password yet. */
  async invite(organizationId: string, userId: string, actor: PlatformActor): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { userId, store: { organizationId } },
      include: { store: true, user: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!membership) throw new NotFoundError('Usuário');
    if (membership.user.passwordHash !== UNUSABLE_PASSWORD) {
      throw new ValidationError('Este usuário já definiu a senha (use "Esqueci minha senha")');
    }
    await this.auth.sendInvite(userId, membership.store.tradeName);
    await this.audit.log(
      {
        action: PlatformAuditAction.INVITE_SENT,
        entity: 'User',
        entityId: userId,
        organizationId,
        storeId: membership.tenantId,
        after: { email: membership.user.email },
      },
      actor,
    );
  }

  /** After any billing change: drop caches and refresh the banners of the organization's stores. */
  async notify(organizationId: string): Promise<void> {
    this.billing.invalidate(organizationId);
    const stores = await this.prisma.store.findMany({
      where: { organizationId },
      select: { id: true },
    });
    // Looked up lazily: the digital menu module depends on this one (no circular import).
    const menu = this.moduleRef.get(MenuRevalidationService, { strict: false });
    for (const s of stores) {
      this.realtime.noticesUpdated(s.id);
      // The digital menu shows "not accepting orders" in read-only mode.
      menu.schedule(s.id);
    }
  }
}
