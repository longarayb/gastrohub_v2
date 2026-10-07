import { Injectable } from '@nestjs/common';
import {
  type PaymentMethod,
  type SettlementDto,
  type SettlementPreviewDto,
  type SettlementStopDto,
  type settlementSchema,
  courierEarnings,
  currentBusinessDay,
  effectivePayRule,
  formatBRL,
  payoutError,
  settlementSummary,
  usesCashRegister,
  withdrawalError,
} from '@app/shared';
import type { z } from 'zod';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { CourierSettlement } from '../../generated/prisma/client.js';
import { CashService } from '../cash/cash.service.js';
import { MenuContext } from '../menu/menu-common.js';
import { OrdersService, paymentSummaryOf } from '../orders/orders.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { CouriersService, courierBalance } from './couriers.service.js';

type SettleInput = z.output<typeof settlementSchema>;

const runInclude = {
  stops: {
    orderBy: { sequence: 'asc' },
    include: {
      order: {
        select: {
          id: true,
          number: true,
          version: true,
          status: true,
          publicCode: true,
          customerName: true,
          totalCents: true,
          paidCents: true,
          deliveryFeeCents: true,
          expectedPaymentMethod: true,
        },
      },
    },
  },
} as const;

/**
 * Courier settlement (docs/DECISOES.md D031): what the courier collected enters the settling
 * operator's open register as payments of the orders; cash and card slips are counted against
 * the expected amounts; the pay (per delivery, fee share, daily once per business day) enters the
 * running balance, and the operator pays now (audited withdrawal) or accumulates.
 */
@Injectable()
export class SettlementsService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store settings and user names are not tenant-scoped models.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly menu: MenuContext,
    private readonly audit: AuditService,
    private readonly cash: CashService,
    private readonly orders: OrdersService,
    private readonly couriers: CouriersService,
    private readonly realtime: RealtimeService,
  ) {}

  private get userId(): string {
    const id = this.ctx.userId;
    if (!id) throw new ForbiddenError('Operação exige um usuário autenticado');
    return id;
  }

  private async store() {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: {
        timezone: true,
        courierPerDeliveryCents: true,
        courierFeeShareBps: true,
        courierDailyCents: true,
      },
    });
    if (!store) throw new NotFoundError('Unidade');
    return store;
  }

  /** Runs, stops and pay of everything the courier has not settled yet. */
  private async compute(client: Db | DbTx, courierId: string, runIds?: string[]) {
    const courier = await client.courier.findFirst({ where: { id: courierId } });
    if (!courier) throw new NotFoundError('Entregador');
    const runs = await client.deliveryRun.findMany({
      where: {
        courierId,
        status: { not: 'SETTLED' },
        ...(runIds && { id: { in: runIds } }),
      },
      include: runInclude,
      orderBy: { departedAt: 'asc' },
    });
    const pendingOf = (run: (typeof runs)[number]) =>
      run.stops.filter((s) => !s.deliveredAt && !s.failedAt).length;
    const ready = runs.filter((r) => pendingOf(r) === 0);
    const stops: SettlementStopDto[] = ready.flatMap((run) =>
      run.stops.map((s) => {
        const canceled = s.order.status === 'CANCELED';
        const delivered = !!s.deliveredAt;
        return {
          stopId: s.id,
          runId: run.id,
          orderId: s.order.id,
          orderNumber: s.order.number,
          customerName: s.order.customerName,
          status: delivered ? 'DELIVERED' : 'FAILED',
          failureReason: s.failureReason,
          orderStatus: s.order.status,
          // Failed attempts and canceled orders bring no money back.
          balanceCents:
            delivered && !canceled ? Math.max(s.order.totalCents - s.order.paidCents, 0) : 0,
          deliveryFeeCents: s.order.deliveryFeeCents,
          method: (s.collectedMethod ?? s.order.expectedPaymentMethod ?? 'CASH') as PaymentMethod,
          declared: !!s.collectedMethod,
          receivedCents: s.receivedCents,
          changeCents: s.changeCents,
        };
      }),
    );
    const delivered = stops.filter((s) => s.status === 'DELIVERED' && s.orderStatus !== 'CANCELED');
    const store = await this.store();
    const rule = effectivePayRule(
      {
        perDeliveryCents: store.courierPerDeliveryCents,
        feeShareBps: store.courierFeeShareBps,
        dailyCents: store.courierDailyCents,
      },
      courier,
    );
    const today = currentBusinessDay(await this.menu.hours(), new Date(), store.timezone).date;
    // The daily is paid once per business day, in the first settlement of the day.
    const settledToday = await client.courierSettlement.count({
      where: { courierId, businessDate: today },
    });
    const includesDaily = settledToday === 0 && delivered.length > 0;
    const earnings = courierEarnings(rule, {
      deliveries: delivered.length,
      deliveryFeesCents: delivered.reduce((t, s) => t + s.deliveryFeeCents, 0),
      includeDaily: includesDaily,
    });
    return { courier, runs, ready, stops, delivered, earnings, includesDaily, pendingOf, today };
  }

  async preview(courierId: string): Promise<SettlementPreviewDto> {
    const c = await this.compute(this.db, courierId);
    return {
      courier: { id: c.courier.id, name: c.courier.name },
      runs: c.runs.map((r) => ({
        id: r.id,
        departedAt: r.departedAt.toISOString(),
        returnedAt: r.returnedAt?.toISOString() ?? null,
        stops: r.stops.length,
        pending: c.pendingOf(r),
      })),
      stops: c.stops,
      earnings: c.earnings,
      includesDaily: c.includesDaily,
      previousBalanceCents: await courierBalance(this.db, courierId),
    };
  }

  async settle(input: SettleInput): Promise<SettlementDto> {
    const userId = this.userId;
    const now = new Date();
    const result = await this.db.$transaction(async (tx) => {
      const session = await this.cash.lockOpenSession(tx, userId);
      if (!session) throw new ValidationError('Abra o caixa para fazer o acerto');
      // One settlement at a time per courier.
      await tx.$queryRaw`SELECT id FROM "Courier" WHERE id = ${input.courierId} FOR UPDATE`;
      const c = await this.compute(tx, input.courierId, input.runIds);
      if (c.runs.length !== new Set(input.runIds).size) {
        throw new ValidationError(
          'Alguma saída já foi acertada ou não é deste entregador. Atualize a tela.',
        );
      }
      if (c.ready.length !== c.runs.length) {
        throw new ValidationError(
          'Há entregas em aberto nesta saída: marque como entregues ou não entregues',
        );
      }

      // How each delivered order was paid (confirmed by the operator).
      const methods = new Map(input.stops.map((s) => [s.stopId, s.method]));
      const stops = c.stops.map((s) =>
        s.status === 'DELIVERED' && methods.has(s.stopId)
          ? { ...s, method: methods.get(s.stopId)! }
          : s,
      );
      const charged = stops.filter((s) => s.status === 'DELIVERED' && s.balanceCents > 0);
      const previousBalanceCents = await courierBalance(tx, input.courierId);
      const summary = settlementSummary({
        stops: charged,
        countedCashCents: input.countedCashCents,
        countedCardCents: input.countedCardCents,
        earningsCents: c.earnings.totalCents,
        previousBalanceCents,
        payoutCents: input.payNowCents,
        deductShortage: input.deductShortage,
      });
      const available =
        previousBalanceCents + c.earnings.totalCents - summary.shortageDeductedCents;
      const payError = payoutError(available, input.payNowCents);
      if (payError) throw new ValidationError(payError);

      // Payments of the orders into the settling register.
      for (const s of charged) {
        const order = await tx.order.findFirstOrThrow({ where: { id: s.orderId } });
        const amountCents = Math.max(order.totalCents - order.paidCents, 0);
        if (amountCents === 0) continue;
        const received =
          s.method === 'CASH' && s.receivedCents != null && s.receivedCents >= amountCents
            ? s.receivedCents
            : null;
        await tx.payment.create({
          data: {
            orderId: s.orderId,
            method: s.method,
            amountCents,
            receivedCents: s.method === 'CASH' ? (received ?? amountCents) : null,
            changeCents: s.method === 'CASH' ? (received ?? amountCents) - amountCents : null,
            cashSessionId: usesCashRegister(s.method) ? session.id : null,
            externalRef: s.method === 'PIX' ? order.publicCode : null,
            createdById: userId,
          },
        });
        const paidCents = order.paidCents + amountCents;
        await this.orders.updateVersioned(tx, s.orderId, order.version, {
          paidCents,
          paymentStatus: paymentSummaryOf(order.totalCents, paidCents).status,
        });
      }

      // Counted cash differs from the expected: the drawer is corrected with a movement.
      if (summary.cashDifferenceCents !== 0) {
        const missing = summary.cashDifferenceCents < 0;
        const amountCents = Math.abs(summary.cashDifferenceCents);
        if (missing) {
          const totals = await this.cash.totals(tx, session.id);
          const error = withdrawalError(totals.expectedCashCents, amountCents);
          if (error) throw new ValidationError(error);
        }
        await tx.cashMovement.create({
          data: {
            sessionId: session.id,
            type: missing ? 'WITHDRAWAL' : 'SUPPLY',
            amountCents,
            reason: `${missing ? 'Falta' : 'Sobra'} no acerto do entregador ${c.courier.name}`,
            createdById: userId,
          },
        });
      }

      const settlement = await tx.courierSettlement.create({
        data: {
          courierId: input.courierId,
          cashSessionId: session.id,
          businessDate: c.today,
          settledById: userId,
          settledAt: now,
          deliveries: c.delivered.length,
          failedDeliveries: stops.filter((s) => s.status === 'FAILED').length,
          deliveryFeesCents: c.delivered.reduce((t, s) => t + s.deliveryFeeCents, 0),
          expectedCashCents: summary.expectedCashCents,
          countedCashCents: summary.countedCashCents,
          cashDifferenceCents: summary.cashDifferenceCents,
          expectedCardCents: summary.expectedCardCents,
          countedCardCents: summary.countedCardCents,
          cardDifferenceCents: summary.cardDifferenceCents,
          otherCents: summary.otherCents,
          perDeliveryCents: c.earnings.perDeliveryCents,
          feeShareCents: c.earnings.feeShareCents,
          dailyCents: c.earnings.dailyCents,
          earningsCents: c.earnings.totalCents,
          previousBalanceCents,
          payoutCents: input.payNowCents,
          shortageDeductedCents: summary.shortageDeductedCents,
          newBalanceCents: summary.newBalanceCents,
          courierOwesCents: summary.courierOwesCents,
          notes: input.notes,
        },
      });
      await tx.deliveryRun.updateMany({
        where: { id: { in: input.runIds } },
        data: { status: 'SETTLED', settlementId: settlement.id, openCourierId: null },
      });
      await tx.deliveryRun.updateMany({
        where: { id: { in: input.runIds }, returnedAt: null },
        data: { returnedAt: now },
      });

      // Running balance: earnings in, deducted shortage and payout out.
      if (c.earnings.totalCents > 0) {
        await tx.courierLedgerEntry.create({
          data: {
            courierId: input.courierId,
            type: 'EARNING',
            amountCents: c.earnings.totalCents,
            settlementId: settlement.id,
            reason: `Acerto · ${c.delivered.length} entrega(s)${c.includesDaily ? ' + diária' : ''}`,
            createdById: userId,
          },
        });
      }
      if (summary.shortageDeductedCents > 0) {
        await tx.courierLedgerEntry.create({
          data: {
            courierId: input.courierId,
            type: 'SHORTAGE',
            amountCents: -summary.shortageDeductedCents,
            settlementId: settlement.id,
            cashSessionId: session.id,
            reason: `Falta de ${formatBRL(summary.shortageDeductedCents)} descontada no acerto`,
            createdById: userId,
          },
        });
      }
      if (input.payNowCents > 0) {
        await this.couriers.payFromRegister(tx, {
          courier: c.courier,
          sessionId: session.id,
          amountCents: input.payNowCents,
          balanceCents: available,
          reason: 'Acerto',
          settlementId: settlement.id,
        });
      }
      await this.audit.log(
        {
          action: AuditAction.COURIER_SETTLED,
          entity: 'CourierSettlement',
          entityId: settlement.id,
          reason: input.notes ?? undefined,
          after: { courier: c.courier.name, ...summary },
        },
        tx,
      );
      return {
        settlement,
        sessionId: session.id,
        orderIds: charged.map((s) => s.orderId),
      };
    });
    for (const id of result.orderIds) await this.orders.publish(id);
    this.cash.notify(result.sessionId);
    this.realtime.deliveryUpdated(this.ctx.tenantId);
    return (await this.toDtos([result.settlement]))[0]!;
  }

  async list(query: { courierId?: string }): Promise<SettlementDto[]> {
    const rows = await this.db.courierSettlement.findMany({
      where: { ...(query.courierId && { courierId: query.courierId }) },
      orderBy: { settledAt: 'desc' },
      take: 50,
    });
    return this.toDtos(rows);
  }

  private async toDtos(rows: CourierSettlement[]): Promise<SettlementDto[]> {
    const [couriers, users] = await Promise.all([
      this.db.courier.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.courierId))] } },
        select: { id: true, name: true },
      }),
      this.prisma.user.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.settledById))] } },
        select: { id: true, name: true },
      }),
    ]);
    const courierName = new Map(couriers.map((c) => [c.id, c.name]));
    const userName = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      courierName: courierName.get(r.courierId) ?? '',
      settledAt: r.settledAt.toISOString(),
      settledByName: userName.get(r.settledById) ?? null,
      deliveries: r.deliveries,
      failedDeliveries: r.failedDeliveries,
      deliveryFeesCents: r.deliveryFeesCents,
      expectedCashCents: r.expectedCashCents,
      countedCashCents: r.countedCashCents,
      cashDifferenceCents: r.cashDifferenceCents,
      expectedCardCents: r.expectedCardCents,
      countedCardCents: r.countedCardCents,
      cardDifferenceCents: r.cardDifferenceCents,
      otherCents: r.otherCents,
      perDeliveryCents: r.perDeliveryCents,
      feeShareCents: r.feeShareCents,
      dailyCents: r.dailyCents,
      earningsCents: r.earningsCents,
      previousBalanceCents: r.previousBalanceCents,
      payoutCents: r.payoutCents,
      shortageDeductedCents: r.shortageDeductedCents,
      newBalanceCents: r.newBalanceCents,
      courierOwesCents: r.courierOwesCents,
      notes: r.notes,
    }));
  }
}
