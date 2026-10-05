import { Injectable } from '@nestjs/common';
import {
  type MenuItemSnapshot,
  type OrderStatus,
  type TaskDetails,
  deriveItemStatus,
  kitchenTransitions,
  routeItem,
  scaleTaskQuantity,
} from '@app/shared';
import type { DbTx } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Prisma } from '../../generated/prisma/client.js';

const OPEN_TASK = { in: ['QUEUED', 'PREPARING'] } satisfies Prisma.EnumProductionTaskStatusFilter;

export interface SentItem {
  id: string;
  orderId: string;
  roundId: string;
  sectorId: string | null;
  quantity: number;
  snapshot: Prisma.JsonValue;
}

/**
 * Production tasks (docs/DECISOES.md D027): one per sector of each sent item, created when the
 * round is sent. Item and order statuses follow them (`sync`). Used by the order flows (send,
 * cancel, close), the tab moves and the KDS.
 */
@Injectable()
export class ProductionService {
  constructor(private readonly ctx: TenantContext) {}

  /** Who acted: a user or a KDS device (history reason when it is a device). */
  private actor() {
    return { userId: this.ctx.userId ?? null, deviceId: this.ctx.deviceId ?? null };
  }

  /** Creates the tasks of items just sent to production. Returns the sectors involved. */
  async createForItems(tx: DbTx, items: SentItem[], sentAt: Date): Promise<string[]> {
    const rows: Prisma.ProductionTaskUncheckedCreateInput[] = [];
    for (const item of items) {
      // No production sector configured at all: nothing to show in a KDS.
      if (!item.sectorId) continue;
      const snapshot = item.snapshot as unknown as MenuItemSnapshot;
      for (const task of routeItem(snapshot, item.quantity, item.sectorId)) {
        rows.push({
          orderId: item.orderId,
          orderItemId: item.id,
          roundId: item.roundId,
          sectorId: task.sectorId,
          kind: task.kind,
          name: task.name,
          quantity: task.quantity,
          details: task.details as unknown as Prisma.InputJsonValue,
          sentAt,
        });
      }
    }
    if (rows.length) await tx.productionTask.createMany({ data: rows });
    return [...new Set(rows.map((r) => r.sectorId))];
  }

  /** Items canceled after sending: their tasks show struck through in every sector. */
  async cancelItems(tx: DbTx, itemIds: string[], now: Date): Promise<void> {
    await tx.productionTask.updateMany({
      where: { orderItemId: { in: itemIds }, status: { not: 'CANCELED' } },
      data: { status: 'CANCELED', canceledAt: now },
    });
  }

  /** The whole order was canceled after sending. */
  async cancelOrder(tx: DbTx, orderId: string, now: Date): Promise<void> {
    await tx.productionTask.updateMany({
      where: { orderId, status: { not: 'CANCELED' } },
      data: { status: 'CANCELED', canceledAt: now },
    });
  }

  /** The order left the kitchen (marked ready on the board, dispatched or closed). */
  async completeOrder(tx: DbTx, orderId: string, now: Date): Promise<void> {
    const open = await tx.productionTask.findMany({
      where: { orderId, status: OPEN_TASK },
      select: { id: true, startedAt: true },
    });
    for (const task of open) {
      await tx.productionTask.update({
        where: { id: task.id },
        data: { status: 'READY', startedAt: task.startedAt ?? now, readyAt: now },
      });
    }
  }

  /**
   * Tasks follow their item when lines move between tabs: a whole line moves its tasks; a
   * split line keeps part of each task and gives the rest to the new line.
   */
  async moveWithItem(
    tx: DbTx,
    move: { itemId: string; targetOrderId: string; targetRoundId: string },
  ): Promise<void> {
    await tx.productionTask.updateMany({
      where: { orderItemId: move.itemId },
      data: { orderId: move.targetOrderId, roundId: move.targetRoundId },
    });
  }

  async splitWithItem(
    tx: DbTx,
    split: {
      itemId: string;
      newItemId: string;
      lineQuantity: number;
      keepQuantity: number;
      targetOrderId: string;
      targetRoundId: string;
    },
  ): Promise<void> {
    const tasks = await tx.productionTask.findMany({ where: { orderItemId: split.itemId } });
    for (const task of tasks) {
      const keep = scaleTaskQuantity(task.quantity, split.lineQuantity, split.keepQuantity);
      await tx.productionTask.update({ where: { id: task.id }, data: { quantity: keep } });
      const { id: _id, tenantId: _tenant, ...copy } = task;
      await tx.productionTask.create({
        data: {
          ...copy,
          details: task.details as Prisma.InputJsonValue,
          orderId: split.targetOrderId,
          orderItemId: split.newItemId,
          roundId: split.targetRoundId,
          quantity: task.quantity - keep,
        },
      });
    }
  }

  /**
   * Item statuses from their tasks, then the automatic order transitions (D027): PREPARING
   * when the first task starts, READY when every active task is ready, back to PREPARING
   * when a "ready" is undone. Returns true when the order status changed.
   */
  async sync(tx: DbTx, orderId: string, now: Date, reason?: string): Promise<boolean> {
    const tasks = await tx.productionTask.findMany({
      where: { orderId },
      select: { orderItemId: true, status: true, startedAt: true, readyAt: true },
    });
    const items = await tx.orderItem.findMany({
      where: { orderId, status: { in: ['QUEUED', 'PREPARING', 'READY'] } },
      select: { id: true, status: true, startedAt: true, readyAt: true },
    });
    for (const item of items) {
      const own = tasks.filter((t) => t.orderItemId === item.id);
      if (!own.length) continue;
      const status = deriveItemStatus(own.map((t) => t.status));
      if (status === 'CANCELED') continue; // item cancellation has its own flow
      const startedAt =
        own
          .map((t) => t.startedAt)
          .filter((d): d is Date => !!d)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const readyAt =
        status === 'READY'
          ? (own
              .map((t) => t.readyAt)
              .filter((d): d is Date => !!d)
              .sort((a, b) => b.getTime() - a.getTime())[0] ?? now)
          : null;
      if (
        status !== item.status ||
        startedAt?.getTime() !== item.startedAt?.getTime() ||
        readyAt?.getTime() !== item.readyAt?.getTime()
      ) {
        await tx.orderItem.update({ where: { id: item.id }, data: { status, startedAt, readyAt } });
      }
    }

    const order = await tx.order.findFirst({
      where: { id: orderId },
      select: { status: true, type: true },
    });
    if (!order) return false;
    const path = kitchenTransitions(
      order.status,
      tasks.map((t) => t.status),
    );
    if (!path.length) return false;
    let from: OrderStatus = order.status;
    const actor = this.actor();
    for (const to of path) {
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: from,
          toStatus: to,
          userId: actor.userId,
          reason: reason ?? (actor.deviceId ? 'Tela da cozinha' : null),
        },
      });
      from = to;
    }
    const final = path.at(-1)!;
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: final,
        readyAt: final === 'READY' ? now : null,
        version: { increment: 1 },
      },
    });
    return true;
  }

  /** Details snapshot type for consumers (KDS, printing). */
  static details(json: Prisma.JsonValue): TaskDetails {
    return json as unknown as TaskDetails;
  }
}
