import { Injectable } from '@nestjs/common';
import {
  type ChangeTableInput,
  type MergeSessionsInput,
  type OrderDetailDto,
  type TableDto,
  isFinalStatus,
  moveItemsPlan,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { newPublicCode, newTrackingToken, nextOrderNumber, toOrderEvent } from './orders.mapper.js';
import { OrdersService } from './orders.service.js';
import { ProductionService } from './production.service.js';
import { TablesService } from './tables.service.js';
import { findFirstSequential } from '../../core/prisma/sequential.js';

const tabInclude = {
  items: true,
  rounds: { orderBy: { number: 'asc' } },
} satisfies Prisma.OrderInclude;
type TabRow = Prisma.OrderGetPayload<{ include: typeof tabInclude }>;

const OPEN = { notIn: ['DELIVERED', 'CANCELED'] } satisfies Prisma.EnumOrderStatusFilter;

/**
 * Table tabs (docs/DECISOES.md D019, D025): moving items between tabs of a table session
 * (whole lines or part of the quantity), transferring a tab to another table, changing,
 * merging and splitting tables, and the pre-bill ("aguardando pagamento").
 */
@Injectable()
export class TabsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    private readonly orders: OrdersService,
    private readonly production: ProductionService,
    private readonly tables: TablesService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  private async openTab(tx: DbTx, id: string) {
    const order = await findFirstSequential<TabRow>(tx.order, {
      where: { id },
      include: tabInclude,
    });
    if (!order) throw new NotFoundError('Conta');
    if (order.type !== 'DINE_IN' || !order.tableSessionId) {
      throw new ValidationError('Somente contas de mesa podem ser transferidas');
    }
    if (isFinalStatus(order.status)) throw new ValidationError('Esta conta já foi encerrada');
    return order;
  }

  private async openSession(tx: DbTx, id: string) {
    const session = await tx.tableSession.findFirst({
      where: { id, closedAt: null },
      include: { tables: { where: { leftAt: null }, include: { table: true } } },
    });
    if (!session) throw new ValidationError('Esta mesa já foi fechada');
    return session;
  }

  /** Open session of a table, or a new one (the table must be active). */
  private async sessionForTable(tx: DbTx, tableId: string): Promise<string> {
    const table = await tx.table.findFirst({ where: { id: tableId, isActive: true } });
    if (!table) throw new ValidationError('Mesa não encontrada');
    const open = await tx.tableSessionTable.findFirst({
      where: { tableId, leftAt: null, session: { closedAt: null } },
      select: { sessionId: true },
    });
    if (open) return open.sessionId;
    const session = await tx.tableSession.create({
      data: { openedById: this.ctx.userId ?? null, waiterId: this.ctx.userId ?? null },
    });
    await tx.tableSessionTable.create({ data: { sessionId: session.id, tableId } });
    return session.id;
  }

  /** Moves tabs to another session; their version changes so open screens reload. */
  private async moveTabs(tx: DbTx, orderIds: string[], sessionId: string): Promise<void> {
    if (!orderIds.length) return;
    await tx.order.updateMany({
      where: { id: { in: orderIds } },
      data: { tableSessionId: sessionId, version: { increment: 1 } },
    });
  }

  private async publishOrders(orderIds: string[]): Promise<void> {
    const orders = await this.db.order.findMany({ where: { id: { in: orderIds } } });
    for (const order of orders) this.realtime.orderUpdated(this.ctx.tenantId, toOrderEvent(order));
    this.realtime.tablesUpdated(this.ctx.tenantId);
  }

  // ---------------------------------------------------------------------------
  // Items between tabs

  async moveItems(
    sourceId: string,
    input: {
      expectedVersion: number;
      items: { itemId: string; quantity: number }[];
      targetOrderId?: string;
      targetExpectedVersion?: number;
      newTabLabel: string | null;
    },
  ): Promise<{ source: OrderDetailDto; target: OrderDetailDto }> {
    const targetId = await this.db.$transaction(async (tx) => {
      const source = await this.openTab(tx, sourceId);
      const result = moveItemsPlan(
        source.items.map((i) => ({
          id: i.id,
          status: i.status,
          quantity: i.quantity,
          unitChargedPriceCents: i.unitChargedPriceCents,
          discountType: i.discountType,
          discountValue: i.discountValue,
        })),
        input.items,
      );
      if (!result.ok) throw new ValidationError(result.message);
      const { plan } = result;

      // Destination: another open tab of the same table session, or a new tab there.
      let target;
      if (input.targetOrderId) {
        if (input.targetOrderId === sourceId) {
          throw new ValidationError('Escolha outra conta de destino');
        }
        target = await this.openTab(tx, input.targetOrderId);
        if (target.tableSessionId !== source.tableSessionId) {
          throw new ValidationError('A conta de destino precisa estar na mesma mesa');
        }
      } else {
        const now = new Date();
        const created = await tx.order.create({
          data: {
            businessDate: source.businessDate,
            number: await nextOrderNumber(tx, this.ctx.tenantId, source.businessDate),
            publicCode: newPublicCode(),
            trackingToken: newTrackingToken(),
            type: 'DINE_IN',
            source: source.source,
            status: source.status,
            tableSessionId: source.tableSessionId,
            tabLabel: input.newTabLabel,
            serviceFeeBps: source.serviceFeeBps,
            serviceFeeWaived: source.serviceFeeWaived,
            serviceFeeWaivedReason: source.serviceFeeWaivedReason,
            createdById: this.ctx.userId ?? null,
            acceptedAt: source.acceptedAt ?? now,
            readyAt: source.readyAt,
          },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: created.id,
            fromStatus: null,
            toStatus: created.status,
            userId: this.ctx.userId ?? null,
            reason: `Conta criada ao dividir a conta nº ${source.number}`,
          },
        });
        target = { ...created, items: [], rounds: [] as typeof source.rounds };
      }

      // Each source round maps to a round of the target with the same sending time (the
      // kitchen history is kept); unsent items go to the target's pending round.
      let nextRound = (target.rounds.at(-1)?.number ?? 0) + 1;
      const roundMap = new Map<string, string>();
      const targetRound = async (sourceRoundId: string): Promise<string> => {
        const known = roundMap.get(sourceRoundId);
        if (known) return known;
        const round = source.rounds.find((r) => r.id === sourceRoundId)!;
        const existing = round.sentAt ? null : target.rounds.find((r) => !r.sentAt);
        const id =
          existing?.id ??
          (
            await tx.orderRound.create({
              data: {
                orderId: target.id,
                number: nextRound++,
                sentAt: round.sentAt,
                sentById: round.sentById,
              },
            })
          ).id;
        roundMap.set(sourceRoundId, id);
        return id;
      };

      const moved: { name: string; quantity: number; totalCents: number }[] = [];
      for (const itemId of plan.whole) {
        const item = source.items.find((i) => i.id === itemId)!;
        const roundId = await targetRound(item.roundId);
        await tx.orderItem.update({ where: { id: itemId }, data: { orderId: target.id, roundId } });
        // Kitchen tasks follow the line (same tickets, same timers).
        await this.production.moveWithItem(tx, {
          itemId,
          targetOrderId: target.id,
          targetRoundId: roundId,
        });
        moved.push({ name: item.name, quantity: item.quantity, totalCents: item.totalCents });
      }
      for (const { itemId, keep, move } of plan.partial) {
        const item = source.items.find((i) => i.id === itemId)!;
        await tx.orderItem.update({
          where: { id: itemId },
          data: {
            quantity: keep.quantity,
            discountValue: keep.discountValue,
            discountCents: keep.discountCents,
            totalCents: keep.totalCents,
          },
        });
        const { id: _id, tenantId: _tenant, createdAt: _created, ...copy } = item;
        const roundId = await targetRound(item.roundId);
        const created = await tx.orderItem.create({
          data: {
            ...copy,
            snapshot: item.snapshot as Prisma.InputJsonValue,
            orderId: target.id,
            roundId,
            quantity: move.quantity,
            discountValue: move.discountValue,
            discountCents: move.discountCents,
            totalCents: move.totalCents,
          },
        });
        await this.production.splitWithItem(tx, {
          itemId,
          newItemId: created.id,
          lineQuantity: item.quantity,
          keepQuantity: keep.quantity,
          targetOrderId: target.id,
          targetRoundId: roundId,
        });
        moved.push({ name: item.name, quantity: move.quantity, totalCents: move.totalCents });
      }

      await this.orders.recalculate(tx, source.id);
      await this.orders.recalculate(tx, target.id);
      await this.orders.updateVersioned(tx, source.id, input.expectedVersion, {});
      if (input.targetOrderId) {
        await this.orders.updateVersioned(tx, target.id, input.targetExpectedVersion ?? -1, {});
      }
      // After the version checks: the kitchen state of both tabs may change their status.
      const now = new Date();
      await this.production.sync(tx, source.id, now);
      await this.production.sync(tx, target.id, now);
      await this.audit.log(
        {
          action: AuditAction.ORDER_ITEMS_MOVED,
          entity: 'Order',
          entityId: source.id,
          before: { number: source.number, totalCents: source.totalCents },
          after: { targetOrderId: target.id, targetNumber: target.number, items: moved },
        },
        tx,
      );
      return target.id;
    });
    const source = await this.orders.publish(sourceId);
    const target = await this.orders.publish(targetId, !input.targetOrderId);
    return { source, target };
  }

  // ---------------------------------------------------------------------------
  // Tabs and tables

  /** Transfers a tab to another table (its session, or a new one if it is free). */
  async transferOrder(
    id: string,
    input: { expectedVersion: number; tableId: string },
  ): Promise<OrderDetailDto> {
    await this.db.$transaction(async (tx) => {
      const order = await this.openTab(tx, id);
      const fromSession = order.tableSessionId!;
      const toSession = await this.sessionForTable(tx, input.tableId);
      if (toSession === fromSession) throw new ValidationError('A conta já está nesta mesa');
      await this.orders.updateVersioned(tx, id, input.expectedVersion, {
        tableSessionId: toSession,
      });
      await tx.tableSession.update({ where: { id: toSession }, data: { billRequestedAt: null } });
      await this.orders.closeSessionIfDone(tx, fromSession, new Date());
      await this.audit.log(
        {
          action: AuditAction.ORDER_TABLE_TRANSFERRED,
          entity: 'Order',
          entityId: id,
          before: { number: order.number, tableSessionId: fromSession },
          after: { tableSessionId: toSession, tableId: input.tableId },
        },
        tx,
      );
    });
    return this.orders.publish(id);
  }

  /** The whole party moves to another (free) table. */
  async changeTable(sessionId: string, input: ChangeTableInput): Promise<TableDto[]> {
    await this.db.$transaction(async (tx) => {
      const session = await this.openSession(tx, sessionId);
      const link = session.tables.find((t) => t.tableId === input.fromTableId);
      if (!link) throw new ValidationError('Esta mesa não faz parte da sessão');
      const table = await tx.table.findFirst({ where: { id: input.toTableId, isActive: true } });
      if (!table) throw new ValidationError('Mesa não encontrada');
      const busy = await tx.tableSessionTable.findFirst({
        where: { tableId: table.id, leftAt: null, session: { closedAt: null } },
      });
      if (busy) {
        throw new ValidationError(
          `A mesa ${table.name} está ocupada. Para juntar, use Juntar mesas.`,
        );
      }
      await tx.tableSessionTable.update({ where: { id: link.id }, data: { leftAt: new Date() } });
      await tx.tableSessionTable.create({ data: { sessionId, tableId: table.id } });
      await this.audit.log(
        {
          action: AuditAction.TABLE_CHANGED,
          entity: 'TableSession',
          entityId: sessionId,
          before: { table: link.table.name },
          after: { table: table.name },
        },
        tx,
      );
    });
    this.realtime.tablesUpdated(this.ctx.tenantId);
    return this.tables.listTables();
  }

  /** Joins another table session into this one (tables and tabs); the other is closed. */
  async merge(sessionId: string, input: MergeSessionsInput): Promise<TableDto[]> {
    const moved = await this.db.$transaction(async (tx) => {
      if (input.sourceSessionId === sessionId) {
        throw new ValidationError('Escolha outra mesa para juntar');
      }
      const target = await this.openSession(tx, sessionId);
      const source = await this.openSession(tx, input.sourceSessionId);
      const now = new Date();
      for (const link of source.tables) {
        await tx.tableSessionTable.update({ where: { id: link.id }, data: { leftAt: now } });
        await tx.tableSessionTable.create({ data: { sessionId, tableId: link.tableId } });
      }
      const tabs = await tx.order.findMany({
        where: { tableSessionId: source.id, status: OPEN },
        select: { id: true },
      });
      await this.moveTabs(
        tx,
        tabs.map((t) => t.id),
        sessionId,
      );
      await tx.tableSession.update({ where: { id: source.id }, data: { closedAt: now } });
      await tx.tableSession.update({ where: { id: sessionId }, data: { billRequestedAt: null } });
      await this.audit.log(
        {
          action: AuditAction.TABLES_MERGED,
          entity: 'TableSession',
          entityId: sessionId,
          after: {
            tables: [...target.tables, ...source.tables].map((t) => t.table.name),
            mergedSessionId: source.id,
          },
        },
        tx,
      );
      return tabs.map((t) => t.id);
    });
    await this.publishOrders(moved);
    return this.tables.listTables();
  }

  /** A table leaves a merged session, taking the chosen tabs to a new session. */
  async split(
    sessionId: string,
    input: { tableId: string; orderIds: string[] },
  ): Promise<TableDto[]> {
    const moved = await this.db.$transaction(async (tx) => {
      const session = await this.openSession(tx, sessionId);
      const link = session.tables.find((t) => t.tableId === input.tableId);
      if (!link) throw new ValidationError('Esta mesa não faz parte da sessão');
      if (session.tables.length < 2) {
        throw new ValidationError('Só é possível separar mesas que foram juntadas');
      }
      const tabs = await tx.order.findMany({
        where: { id: { in: input.orderIds }, tableSessionId: sessionId, status: OPEN },
        select: { id: true },
      });
      if (tabs.length !== input.orderIds.length) {
        throw new ValidationError('Conta não encontrada nesta mesa');
      }
      const now = new Date();
      const created = await tx.tableSession.create({
        data: { openedById: this.ctx.userId ?? null, waiterId: session.waiterId },
      });
      await tx.tableSessionTable.update({ where: { id: link.id }, data: { leftAt: now } });
      await tx.tableSessionTable.create({
        data: { sessionId: created.id, tableId: input.tableId },
      });
      await this.moveTabs(tx, input.orderIds, created.id);
      // A side left without tabs frees its tables.
      await this.orders.closeSessionIfDone(tx, sessionId, now);
      await this.orders.closeSessionIfDone(tx, created.id, now);
      await this.audit.log(
        {
          action: AuditAction.TABLES_SPLIT,
          entity: 'TableSession',
          entityId: sessionId,
          after: { table: link.table.name, newSessionId: created.id, orderIds: input.orderIds },
        },
        tx,
      );
      return input.orderIds;
    });
    await this.publishOrders(moved);
    return this.tables.listTables();
  }

  /** Pre-bill printed: the table shows "aguardando pagamento" until a new round. */
  async requestBill(sessionId: string): Promise<TableDto[]> {
    await this.db.$transaction(async (tx) => {
      await this.openSession(tx, sessionId);
      await tx.tableSession.update({
        where: { id: sessionId },
        data: { billRequestedAt: new Date() },
      });
    });
    this.realtime.tablesUpdated(this.ctx.tenantId);
    return this.tables.listTables();
  }
}
