import { Injectable } from '@nestjs/common';
import {
  type CourierDetailDto,
  type CourierLedgerEntryDto,
  type CourierPaySettingsDto,
  type courierPaySchema,
  type courierPayoutSchema,
  type courierUpdateSchema,
  courierStatus,
  formatBRL,
  payoutError,
  withdrawalError,
} from '@app/shared';
import type { z } from 'zod';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { CashService } from '../cash/cash.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

/** Running balance of a courier: positive = the restaurant owes the courier. */
export async function courierBalance(client: Db | DbTx, courierId: string): Promise<number> {
  const sum = await client.courierLedgerEntry.aggregate({
    where: { courierId },
    _sum: { amountCents: true },
  });
  return sum._sum.amountCents ?? 0;
}

/** Couriers: status, pay rule, app user, running balance and payouts (D030–D031). */
@Injectable()
export class CouriersService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store settings, memberships and user names are not tenant-scoped models.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
    private readonly cash: CashService,
    private readonly realtime: RealtimeService,
  ) {}

  private get userId(): string {
    const id = this.ctx.userId;
    if (!id) throw new ForbiddenError('Operação exige um usuário autenticado');
    return id;
  }

  private async userNames(ids: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))] as string[];
    if (!unique.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  async list(): Promise<CourierDetailDto[]> {
    const [couriers, balances] = await Promise.all([
      this.db.courier.findMany({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: {
          runs: {
            where: { status: { not: 'SETTLED' } },
            include: { stops: { select: { deliveredAt: true } } },
            orderBy: { departedAt: 'asc' },
          },
        },
      }),
      this.db.courierLedgerEntry.groupBy({ by: ['courierId'], _sum: { amountCents: true } }),
    ]);
    const balance = new Map(balances.map((b) => [b.courierId, b._sum.amountCents ?? 0]));
    const names = await this.userNames(couriers.map((c) => c.userId));
    return couriers.map((c) => {
      const open = c.runs.find((r) => r.status === 'OUT');
      return {
        id: c.id,
        name: c.name,
        phone: c.phone,
        isActive: c.isActive,
        userId: c.userId,
        userName: c.userId ? (names.get(c.userId) ?? null) : null,
        status: courierStatus({ isActive: c.isActive, hasOpenRun: !!open }),
        balanceCents: balance.get(c.id) ?? 0,
        perDeliveryCents: c.perDeliveryCents,
        feeShareBps: c.feeShareBps,
        dailyCents: c.dailyCents,
        openRun: open
          ? {
              id: open.id,
              departedAt: open.departedAt.toISOString(),
              stops: open.stops.length,
              delivered: open.stops.filter((s) => s.deliveredAt).length,
            }
          : null,
        pendingSettlementRuns: c.runs.length,
      };
    });
  }

  async update(id: string, input: z.output<typeof courierUpdateSchema>): Promise<void> {
    const courier = await this.db.courier.findFirst({ where: { id } });
    if (!courier) throw new NotFoundError('Entregador');
    if (!input.isActive && courier.isActive) {
      const open = await this.db.deliveryRun.count({ where: { openCourierId: id } });
      if (open) throw new ValidationError('O entregador está em rota: registre a volta antes');
    }
    if (input.userId) {
      const member = await this.prisma.membership.findFirst({
        where: { tenantId: this.ctx.tenantId, userId: input.userId, role: 'COURIER' },
      });
      if (!member) {
        const message = 'Escolha um usuário com o papel Entregador nesta unidade';
        throw new ValidationError(message, [{ path: 'userId', message }]);
      }
      const linked = await this.db.courier.findFirst({
        where: { userId: input.userId, id: { not: id } },
      });
      if (linked) {
        const message = `Este usuário já está vinculado ao entregador ${linked.name}`;
        throw new ValidationError(message, [{ path: 'userId', message }]);
      }
    }
    const pay = {
      perDeliveryCents: input.perDeliveryCents ?? null,
      feeShareBps: input.feeShareBps ?? null,
      dailyCents: input.dailyCents ?? null,
    };
    await this.db.$transaction(async (tx) => {
      await tx.courier.update({
        where: { id },
        data: {
          name: input.name,
          phone: input.phone,
          isActive: input.isActive,
          userId: input.userId,
          ...pay,
        },
      });
      const before = {
        perDeliveryCents: courier.perDeliveryCents,
        feeShareBps: courier.feeShareBps,
        dailyCents: courier.dailyCents,
      };
      if (JSON.stringify(before) !== JSON.stringify(pay)) {
        await this.audit.log(
          {
            action: AuditAction.COURIER_PAY_CHANGED,
            entity: 'Courier',
            entityId: id,
            before,
            after: pay,
          },
          tx,
        );
      }
    });
    this.realtime.deliveryUpdated(this.ctx.tenantId);
  }

  async paySettings(): Promise<CourierPaySettingsDto> {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { courierPerDeliveryCents: true, courierFeeShareBps: true, courierDailyCents: true },
    });
    if (!store) throw new NotFoundError('Unidade');
    return {
      perDeliveryCents: store.courierPerDeliveryCents,
      feeShareBps: store.courierFeeShareBps,
      dailyCents: store.courierDailyCents,
    };
  }

  async updatePaySettings(
    input: z.output<typeof courierPaySchema>,
  ): Promise<CourierPaySettingsDto> {
    const before = await this.paySettings();
    await this.prisma.store.update({
      where: { id: this.ctx.tenantId },
      data: {
        courierPerDeliveryCents: input.perDeliveryCents,
        courierFeeShareBps: input.feeShareBps,
        courierDailyCents: input.dailyCents,
      },
    });
    await this.audit.log({
      action: AuditAction.COURIER_PAY_CHANGED,
      entity: 'Store',
      entityId: this.ctx.tenantId,
      before,
      after: input,
    });
    return this.paySettings();
  }

  /** Ledger with the balance after each entry (newest first). */
  async ledger(courierId: string): Promise<CourierLedgerEntryDto[]> {
    const courier = await this.db.courier.findFirst({ where: { id: courierId } });
    if (!courier) throw new NotFoundError('Entregador');
    const entries = await this.db.courierLedgerEntry.findMany({
      where: { courierId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const names = await this.userNames(entries.map((e) => e.createdById));
    let balance = 0;
    return entries
      .map((e) => {
        balance += e.amountCents;
        return {
          id: e.id,
          type: e.type,
          amountCents: e.amountCents,
          reason: e.reason,
          createdByName: names.get(e.createdById) ?? null,
          createdAt: e.createdAt.toISOString(),
          balanceAfterCents: balance,
        };
      })
      .reverse();
  }

  /**
   * Pays the courier from the balance (e.g. weekly): a withdrawal of the operator's open
   * register, audited, and a PAYOUT entry in the ledger.
   */
  async payout(
    courierId: string,
    input: z.output<typeof courierPayoutSchema>,
  ): Promise<CourierLedgerEntryDto[]> {
    const userId = this.userId;
    const sessionId = await this.db.$transaction(async (tx) => {
      const courier = await tx.courier.findFirst({ where: { id: courierId } });
      if (!courier) throw new NotFoundError('Entregador');
      const session = await this.cash.lockOpenSession(tx, userId);
      if (!session) throw new ValidationError('Abra o caixa para pagar o entregador');
      await this.payFromRegister(tx, {
        courier,
        sessionId: session.id,
        amountCents: input.amountCents,
        balanceCents: await courierBalance(tx, courierId),
        reason: input.reason,
        settlementId: null,
      });
      return session.id;
    });
    this.cash.notify(sessionId);
    this.realtime.deliveryUpdated(this.ctx.tenantId);
    return this.ledger(courierId);
  }

  /** Withdrawal + ledger PAYOUT + audit (standalone payout or "pagar agora" in a settlement). */
  async payFromRegister(
    tx: DbTx,
    input: {
      courier: { id: string; name: string };
      sessionId: string;
      amountCents: number;
      balanceCents: number;
      reason: string | null;
      settlementId: string | null;
    },
  ): Promise<void> {
    const balanceError = payoutError(input.balanceCents, input.amountCents);
    if (balanceError) throw new ValidationError(balanceError);
    const totals = await this.cash.totals(tx, input.sessionId);
    const cashError = withdrawalError(totals.expectedCashCents, input.amountCents);
    if (cashError) throw new ValidationError(cashError);
    const reason = `Pagamento ao entregador ${input.courier.name}${input.reason ? ` · ${input.reason}` : ''}`;
    const movement = await tx.cashMovement.create({
      data: {
        sessionId: input.sessionId,
        type: 'WITHDRAWAL',
        amountCents: input.amountCents,
        reason,
        createdById: this.userId,
      },
    });
    await tx.courierLedgerEntry.create({
      data: {
        courierId: input.courier.id,
        type: 'PAYOUT',
        amountCents: -input.amountCents,
        settlementId: input.settlementId,
        cashSessionId: input.sessionId,
        cashMovementId: movement.id,
        reason: input.reason,
        createdById: this.userId,
      },
    });
    await this.audit.log(
      {
        action: AuditAction.COURIER_PAYOUT,
        entity: 'Courier',
        entityId: input.courier.id,
        reason: input.reason ?? undefined,
        after: {
          amountCents: input.amountCents,
          amount: formatBRL(input.amountCents),
          cashSessionId: input.sessionId,
          settlementId: input.settlementId,
        },
      },
      tx,
    );
  }
}
