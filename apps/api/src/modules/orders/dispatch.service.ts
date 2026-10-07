import { Injectable } from '@nestjs/common';
import {
  DELIVERY_FAILURE_LABELS,
  type DeliveryFailureReason,
  currentBusinessDay,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import type { DbTx } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { DeliveryRun } from '../../generated/prisma/client.js';
import { MenuContext } from '../menu/menu-common.js';

/**
 * Routes of the couriers (docs/DECISOES.md D030): one open run per courier with one stop per
 * delivery attempt. Used inside the order transactions (dispatch, delivered, canceled) and by
 * the courier app (delivered, not delivered).
 */
@Injectable()
export class DispatchService {
  constructor(
    // Store (timezone) is the tenant itself, not a tenant-scoped model.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly menu: MenuContext,
    private readonly audit: AuditService,
  ) {}

  /** Open run of a courier, created on demand. Locks the courier row (one open run each). */
  async openRun(tx: DbTx, courierId: string, now: Date): Promise<DeliveryRun> {
    await tx.$queryRaw`SELECT id FROM "Courier" WHERE id = ${courierId} FOR UPDATE`;
    const open = await tx.deliveryRun.findFirst({ where: { openCourierId: courierId } });
    if (open) return open;
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { timezone: true },
    });
    const day = currentBusinessDay(
      await this.menu.hours(),
      now,
      store?.timezone ?? 'America/Sao_Paulo',
    );
    return tx.deliveryRun.create({
      data: {
        courierId,
        openCourierId: courierId,
        businessDate: day.date,
        departedAt: now,
        createdById: this.ctx.userId ?? null,
      },
    });
  }

  /** A new delivery attempt of an order in the courier's open run. */
  async addStop(tx: DbTx, orderId: string, courierId: string, now: Date): Promise<void> {
    const run = await this.openRun(tx, courierId, now);
    const sequence = (await tx.deliveryStop.count({ where: { runId: run.id } })) + 1;
    await tx.deliveryStop.create({ data: { runId: run.id, orderId, sequence, dispatchedAt: now } });
    const delivery = await tx.orderDelivery.findFirst({ where: { orderId } });
    if (delivery) {
      await tx.orderDelivery.update({
        where: { id: delivery.id },
        data: { attempts: { increment: 1 } },
      });
    } else {
      // Orders created before the delivery areas (or imported): no area data.
      await tx.orderDelivery.create({ data: { orderId, areaSource: 'NONE', attempts: 1 } });
    }
  }

  private pendingStop(tx: DbTx, orderId: string) {
    return tx.deliveryStop.findFirst({
      where: { orderId, deliveredAt: null, failedAt: null },
      orderBy: { dispatchedAt: 'desc' },
    });
  }

  /** The order was delivered (board, courier app): closes its pending stop. */
  async markDelivered(tx: DbTx, orderId: string, now: Date): Promise<void> {
    const stop = await this.pendingStop(tx, orderId);
    if (stop) await tx.deliveryStop.update({ where: { id: stop.id }, data: { deliveredAt: now } });
  }

  /** Canceled while out for delivery: the pending stop ends as not delivered. */
  async cancelPendingStop(tx: DbTx, orderId: string, now: Date): Promise<void> {
    const stop = await this.pendingStop(tx, orderId);
    if (stop) {
      await tx.deliveryStop.update({
        where: { id: stop.id },
        data: { failedAt: now, failureReason: 'OTHER', failureNote: 'Pedido cancelado' },
      });
    }
  }

  /**
   * Not delivered: the stop records why and the order goes back to the store as READY with the
   * failure visible (board and expedition), to be dispatched again or canceled.
   */
  async fail(
    tx: DbTx,
    orderId: string,
    input: { reason: DeliveryFailureReason; note: string | null },
  ): Promise<void> {
    const order = await tx.order.findFirst({ where: { id: orderId } });
    if (!order) throw new NotFoundError('Pedido');
    const stop = await this.pendingStop(tx, orderId);
    if (order.status !== 'DISPATCHED' || !stop) {
      throw new ValidationError('Este pedido não está em rota de entrega');
    }
    const now = new Date();
    await tx.deliveryStop.update({
      where: { id: stop.id },
      data: { failedAt: now, failureReason: input.reason, failureNote: input.note },
    });
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'READY', courierId: null, dispatchedAt: null, version: { increment: 1 } },
    });
    const label = DELIVERY_FAILURE_LABELS[input.reason];
    await tx.orderStatusHistory.create({
      data: {
        orderId,
        fromStatus: 'DISPATCHED',
        toStatus: 'READY',
        userId: this.ctx.userId ?? null,
        reason: `Entrega não realizada: ${label}${input.note ? ` (${input.note})` : ''}`,
      },
    });
    await this.audit.log(
      {
        action: AuditAction.DELIVERY_FAILED,
        entity: 'Order',
        entityId: orderId,
        reason: input.note ?? label,
        after: { number: order.number, stopId: stop.id, reason: input.reason },
      },
      tx,
    );
  }
}
