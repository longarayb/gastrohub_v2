import { Injectable } from '@nestjs/common';
import {
  KDS_RECENT_LIMIT,
  KDS_RECENT_MINUTES,
  type KdsBoardDto,
  type KdsExpeditionDto,
  type KdsExpeditionOrderDto,
  type KdsProductDto,
  type KdsSectorDto,
  type KdsTaskDto,
  type KdsTicketDto,
  type OrderType,
  Permission,
  hasPermission,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { OrdersService } from '../orders/orders.service.js';
import { ProductionService } from '../orders/production.service.js';

const OPEN = ['QUEUED', 'PREPARING'] as const;

const taskInclude = {
  item: { select: { status: true } },
  round: { select: { number: true } },
  order: {
    select: {
      id: true,
      number: true,
      type: true,
      status: true,
      source: true,
      version: true,
      tabLabel: true,
      customerName: true,
      tableSession: {
        select: {
          tables: { where: { leftAt: null }, select: { table: { select: { name: true } } } },
        },
      },
    },
  },
} satisfies Prisma.ProductionTaskInclude;
type TaskRow = Prisma.ProductionTaskGetPayload<{ include: typeof taskInclude }>;

/** "Mesa 2 + 3 · Carlos", the customer, or "Balcão". */
function orderTitle(o: {
  type: OrderType;
  tabLabel: string | null;
  customerName: string | null;
  tableSession: { tables: { table: { name: string } }[] } | null;
}): string {
  if (o.type === 'DINE_IN') {
    const names = o.tableSession?.tables.map((t) => t.table.name) ?? [];
    const table = names.length ? `Mesa ${names.join(' + ')}` : 'Mesa';
    return o.tabLabel ? `${table} · ${o.tabLabel}` : table;
  }
  return o.customerName ?? (o.type === 'TAKEOUT' ? 'Balcão' : 'Delivery');
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toTask(t: TaskRow): KdsTaskDto {
  return {
    id: t.id,
    orderItemId: t.orderItemId,
    kind: t.kind,
    name: t.name,
    quantity: t.quantity,
    details: ProductionService.details(t.details),
    status: t.status,
    startedAt: iso(t.startedAt),
    readyAt: iso(t.readyAt),
    canceledAt: iso(t.canceledAt),
    recallCount: t.recallCount,
    served: t.item.status === 'SERVED',
  };
}

/**
 * Kitchen display (docs/DECISOES.md D027): tickets per (round, sector), task actions with
 * automatic item/order status, expedition with serve and dispatch, sold-out from the screen.
 * Devices only reach their own sectors (and the expedition when allowed).
 */
@Injectable()
export class KdsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    private readonly orders: OrdersService,
    private readonly production: ProductionService,
    private readonly audit: AuditService,
  ) {}

  private async device() {
    const id = this.ctx.deviceId;
    if (!id) return null;
    const device = await this.db.kdsDevice.findFirst({ where: { id, revokedAt: null } });
    if (!device) throw new ForbiddenError('Esta tela foi desvinculada pelo gerente');
    return device;
  }

  /** Sectors this screen may show (a device: its own; a user: every active sector). */
  async sectors(): Promise<KdsSectorDto[]> {
    const device = await this.device();
    const sectors = await this.db.productionSector.findMany({
      where: { isActive: true, ...(device && { id: { in: device.sectorIds } }) },
      orderBy: { sortOrder: 'asc' },
    });
    return sectors.map((s) => ({
      id: s.id,
      name: s.name,
      warnAfterMinutes: s.warnAfterMinutes,
      lateAfterMinutes: s.lateAfterMinutes,
    }));
  }

  private async allowedSectorIds(requested: string[]): Promise<string[]> {
    const allowed = (await this.sectors()).map((s) => s.id);
    if (!requested.length) return allowed;
    const forbidden = requested.filter((id) => !allowed.includes(id));
    if (forbidden.length) throw new ForbiddenError('Esta tela não mostra este setor');
    return requested;
  }

  // ---------------------------------------------------------------------------
  // Board

  async board(requested: string[]): Promise<KdsBoardDto> {
    const sectorIds = await this.allowedSectorIds(requested);
    const now = new Date();
    const since = new Date(now.getTime() - KDS_RECENT_MINUTES * 60_000);
    // Tickets with work left, or finished/canceled recently (whole tickets are loaded below).
    const keys = await this.db.productionTask.findMany({
      where: {
        sectorId: { in: sectorIds },
        order: { status: { not: 'PENDING' } },
        OR: [
          { status: { in: [...OPEN] } },
          { readyAt: { gte: since } },
          { canceledAt: { gte: since } },
        ],
      },
      select: { roundId: true, sectorId: true },
      distinct: ['roundId', 'sectorId'],
    });
    const tasks = keys.length
      ? await this.db.productionTask.findMany({
          where: { OR: keys.map((k) => ({ roundId: k.roundId, sectorId: k.sectorId })) },
          include: taskInclude,
          orderBy: [{ sentAt: 'asc' }, { name: 'asc' }],
        })
      : [];

    const tickets = new Map<string, TaskRow[]>();
    for (const task of tasks) {
      const key = `${task.roundId}:${task.sectorId}`;
      tickets.set(key, [...(tickets.get(key) ?? []), task]);
    }
    const all = [...tickets].map(([key, rows]): KdsTicketDto => {
      const first = rows[0]!;
      const active = rows.filter((r) => r.status !== 'CANCELED');
      const done = active.length > 0 && active.every((r) => r.status === 'READY');
      return {
        key,
        orderId: first.order.id,
        orderNumber: first.order.number,
        orderType: first.order.type,
        orderStatus: first.order.status,
        orderSource: first.order.source,
        orderVersion: first.order.version,
        title: orderTitle(first.order),
        roundId: first.roundId,
        roundNumber: first.round.number,
        sectorId: first.sectorId,
        sentAt: first.sentAt.toISOString(),
        doneAt: done
          ? new Date(Math.max(...active.map((r) => r.readyAt?.getTime() ?? 0))).toISOString()
          : null,
        canceled: active.length === 0,
        tasks: rows.map(toTask),
      };
    });
    // Finished tickets: only the recent ones, and a bounded number (screens stay open all day).
    const open = all.filter((t) => !t.doneAt);
    const done = all
      .filter((t) => t.doneAt && t.doneAt >= since.toISOString())
      .sort((a, b) => b.doneAt!.localeCompare(a.doneAt!))
      .slice(0, KDS_RECENT_LIMIT);
    const visible = [...open, ...done].filter(
      (t) =>
        !t.canceled ||
        t.tasks.some((task) => task.canceledAt && task.canceledAt >= since.toISOString()),
    );
    return {
      sectors: (await this.sectors()).filter((s) => sectorIds.includes(s.id)),
      tickets: visible.sort((a, b) => a.sentAt.localeCompare(b.sentAt)),
      serverTime: now.toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Task actions

  private async tasksOf(taskIds: string[]) {
    const sectorIds = await this.allowedSectorIds([]);
    const tasks = await this.db.productionTask.findMany({
      where: { id: { in: taskIds } },
      include: { order: { select: { status: true } }, item: { select: { status: true } } },
    });
    if (tasks.length !== taskIds.length) throw new NotFoundError('Item da cozinha');
    if (tasks.some((t) => !sectorIds.includes(t.sectorId))) {
      throw new ForbiddenError('Esta tela não mostra este setor');
    }
    if (tasks.some((t) => ['PENDING', 'CANCELED'].includes(t.order.status))) {
      throw new ValidationError('Pedido ainda não aceito ou cancelado');
    }
    return tasks;
  }

  private actorFields(kind: 'started' | 'ready') {
    const userId = this.ctx.userId ?? null;
    const deviceId = this.ctx.deviceId ?? null;
    return kind === 'started'
      ? { startedByUserId: userId, startedByDeviceId: deviceId }
      : { readyByUserId: userId, readyByDeviceId: deviceId };
  }

  /** Publishes the orders touched (realtime notification after the commit). */
  private async publish(orderIds: Iterable<string>): Promise<void> {
    for (const id of new Set(orderIds)) await this.orders.publish(id);
  }

  async start(taskIds: string[]): Promise<void> {
    const orderIds = await this.db.$transaction(async (tx) => {
      const tasks = await this.tasksOf(taskIds);
      const now = new Date();
      const queued = tasks.filter((t) => t.status === 'QUEUED');
      for (const task of queued) {
        await tx.productionTask.update({
          where: { id: task.id },
          data: { status: 'PREPARING', startedAt: now, ...this.actorFields('started') },
        });
      }
      const touched = [...new Set(queued.map((t) => t.orderId))];
      for (const id of touched) await this.production.sync(tx, id, now);
      return touched;
    });
    await this.publish(orderIds);
  }

  async ready(taskIds: string[]): Promise<void> {
    const orderIds = await this.db.$transaction(async (tx) => {
      const tasks = await this.tasksOf(taskIds);
      const now = new Date();
      const open = tasks.filter((t) => t.status === 'QUEUED' || t.status === 'PREPARING');
      for (const task of open) {
        await tx.productionTask.update({
          where: { id: task.id },
          data: {
            status: 'READY',
            startedAt: task.startedAt ?? now,
            readyAt: now,
            ...(task.startedAt ? {} : this.actorFields('started')),
            ...this.actorFields('ready'),
          },
        });
      }
      const touched = [...new Set(open.map((t) => t.orderId))];
      for (const id of touched) await this.production.sync(tx, id, now);
      return touched;
    });
    await this.publish(orderIds);
  }

  /** Undo a "ready" marked by mistake (audited; not after the item was handed over). */
  async recall(taskId: string): Promise<void> {
    const orderId = await this.db.$transaction(async (tx) => {
      const [task] = await this.tasksOf([taskId]);
      if (task!.status !== 'READY') throw new ValidationError('Este item não está pronto');
      if (
        task!.item.status === 'SERVED' ||
        ['DISPATCHED', 'DELIVERED'].includes(task!.order.status)
      ) {
        throw new ValidationError('Este item já foi entregue');
      }
      const now = new Date();
      await tx.productionTask.update({
        where: { id: taskId },
        data: { status: 'PREPARING', readyAt: null, recallCount: { increment: 1 } },
      });
      await this.production.sync(tx, task!.orderId, now);
      await this.audit.log(
        {
          action: AuditAction.KDS_TASK_RECALLED,
          entity: 'Order',
          entityId: task!.orderId,
          before: { taskId, name: task!.name, readyAt: task!.readyAt },
          after: { deviceId: this.ctx.deviceId ?? null },
        },
        tx,
      );
      return task!.orderId;
    });
    await this.publish([orderId]);
  }

  // ---------------------------------------------------------------------------
  // Expedition

  private async assertExpedition(): Promise<void> {
    const device = await this.device();
    if (device && !device.showsExpedition) {
      throw new ForbiddenError('Esta tela não mostra a expedição');
    }
  }

  async expedition(): Promise<KdsExpeditionDto> {
    await this.assertExpedition();
    const now = new Date();
    const orders = await this.db.order.findMany({
      where: {
        status: { in: ['ACCEPTED', 'PREPARING', 'READY'] },
        // Rounds with something sent and not handed over yet.
        items: { some: { status: { in: ['QUEUED', 'PREPARING', 'READY'] } } },
        tasks: { some: {} },
      },
      include: {
        courier: { select: { name: true } },
        tableSession: {
          select: {
            tables: { where: { leftAt: null }, select: { table: { select: { name: true } } } },
          },
        },
        rounds: { orderBy: { number: 'asc' } },
        items: { select: { roundId: true, status: true } },
        tasks: { select: { roundId: true, sectorId: true, status: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    const sectors = await this.db.productionSector.findMany({ select: { id: true, name: true } });
    const sectorName = new Map(sectors.map((s) => [s.id, s.name]));

    const result = orders.map((o): KdsExpeditionOrderDto => {
      const rounds = o.rounds
        .filter(
          (r) =>
            r.sentAt &&
            o.items.some(
              (i) => i.roundId === r.id && ['QUEUED', 'PREPARING', 'READY'].includes(i.status),
            ),
        )
        .map((r) => {
          const tasks = o.tasks.filter((t) => t.roundId === r.id && t.status !== 'CANCELED');
          const bySector = [...new Set(tasks.map((t) => t.sectorId))].map((sectorId) => {
            const own = tasks.filter((t) => t.sectorId === sectorId);
            return {
              sectorId,
              name: sectorName.get(sectorId) ?? 'Setor',
              total: own.length,
              ready: own.filter((t) => t.status === 'READY').length,
            };
          });
          return {
            roundId: r.id,
            number: r.number,
            sentAt: r.sentAt!.toISOString(),
            sectors: bySector,
            complete: tasks.length > 0 && tasks.every((t) => t.status === 'READY'),
          };
        })
        .filter((r) => r.sectors.length > 0);
      return {
        orderId: o.id,
        number: o.number,
        type: o.type,
        status: o.status,
        version: o.version,
        title: orderTitle(o),
        courierId: o.courierId,
        courierName: o.courier?.name ?? null,
        rounds,
        complete: rounds.length > 0 && rounds.every((r) => r.complete),
      };
    });
    const couriers = await this.db.courier.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return {
      orders: result.filter((o) => o.rounds.length > 0),
      couriers,
      serverTime: now.toISOString(),
    };
  }

  /** Dine-in and takeout: the round was handed over; the order status does not change. */
  async serve(orderId: string, roundIds: string[]): Promise<void> {
    await this.assertExpedition();
    await this.db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id: orderId } });
      if (!order) throw new NotFoundError('Pedido');
      if (order.type === 'DELIVERY') {
        throw new ValidationError('Delivery sai pela expedição com o entregador');
      }
      const tasks = await tx.productionTask.findMany({
        where: { orderId, roundId: { in: roundIds }, status: { not: 'CANCELED' } },
      });
      if (!tasks.length) throw new NotFoundError('Rodada');
      if (tasks.some((t) => t.status !== 'READY')) {
        throw new ValidationError('Ainda há itens em preparo nesta rodada');
      }
      await tx.orderItem.updateMany({
        where: { orderId, roundId: { in: roundIds }, status: 'READY' },
        data: { status: 'SERVED', servedAt: new Date() },
      });
    });
    await this.publish([orderId]);
  }

  /** Delivery leaves with a courier (same rules as the board: courier, then DISPATCHED). */
  async dispatch(
    orderId: string,
    input: { expectedVersion: number; courierId: string },
  ): Promise<void> {
    await this.assertExpedition();
    if (!this.ctx.deviceId && !hasPermission(this.ctx.role, Permission.ORDERS_UPDATE_STATUS)) {
      throw new ForbiddenError();
    }
    await this.db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id: orderId } });
      if (!order) throw new NotFoundError('Pedido');
      if (order.type !== 'DELIVERY')
        throw new ValidationError('Somente pedidos de delivery saem para entrega');
      if (order.status !== 'READY') throw new ValidationError('O pedido ainda não está pronto');
      const courier = await tx.courier.findFirst({
        where: { id: input.courierId, isActive: true },
      });
      if (!courier) throw new ValidationError('Entregador não encontrado');
      const now = new Date();
      await this.orders.updateVersioned(tx, orderId, input.expectedVersion, {
        courierId: courier.id,
        status: 'DISPATCHED',
        dispatchedAt: now,
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: 'READY',
          toStatus: 'DISPATCHED',
          userId: this.ctx.userId ?? null,
          reason: `Expedição · ${courier.name}`,
        },
      });
      await this.production.completeOrder(tx, orderId, now);
      await tx.orderItem.updateMany({
        where: { orderId, status: 'READY' },
        data: { status: 'SERVED', servedAt: now },
      });
    });
    await this.publish([orderId]);
  }

  // ---------------------------------------------------------------------------
  // Sold out ("Acabou") from the screen

  async products(requested: string[]): Promise<KdsProductDto[]> {
    const sectorIds = await this.allowedSectorIds(requested);
    const defaultSector = await this.db.productionSector.findFirst({ where: { isDefault: true } });
    const includesDefault = !!defaultSector && sectorIds.includes(defaultSector.id);
    const now = new Date();
    const products = await this.db.product.findMany({
      where: {
        deletedAt: null,
        OR: [{ sectorId: { in: sectorIds } }, ...(includesDefault ? [{ sectorId: null }] : [])],
      },
      include: { category: { select: { name: true, sortOrder: true } } },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    });
    return products.map((p) => {
      const paused = p.isPaused && (!p.pausedUntil || p.pausedUntil > now);
      return {
        id: p.id,
        name: p.name,
        sectorId: p.sectorId,
        categoryName: p.category.name,
        paused,
        pausedUntil: paused ? iso(p.pausedUntil) : null,
      };
    });
  }
}
