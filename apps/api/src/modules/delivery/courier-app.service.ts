import { Injectable } from '@nestjs/common';
import {
  type Address,
  type CourierAppDto,
  type CourierAppStopDto,
  type DeliveryFailureReason,
  type PaymentMethod,
  type collectionSchema,
  mapLinks,
} from '@app/shared';
import type { z } from 'zod';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { DeliveryRun } from '../../generated/prisma/client.js';
import { DispatchService } from '../orders/dispatch.service.js';
import { OrdersService } from '../orders/orders.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';

type Collection = z.output<typeof collectionSchema>;

const collectionData = (c: Collection) => ({
  collectedMethod: c.method,
  collectedCents: c.amountCents,
  receivedCents: c.method === 'CASH' ? (c.receivedCents ?? c.amountCents) : null,
  changeCents: c.method === 'CASH' ? (c.receivedCents ?? c.amountCents) - c.amountCents : null,
  collectedNote: c.note,
});

/**
 * Courier app (/entregas, docs/DECISOES.md D030): the signed-in courier sees only the deliveries
 * of their own open route (LGPD) — no board, no other orders, nothing after the return.
 */
@Injectable()
export class CourierAppService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly ctx: TenantContext,
    private readonly orders: OrdersService,
    private readonly dispatch: DispatchService,
    private readonly realtime: RealtimeService,
  ) {}

  private async courier() {
    const userId = this.ctx.userId;
    if (!userId) throw new ForbiddenError();
    return this.db.courier.findFirst({ where: { userId, isActive: true } });
  }

  /** A stop of the signed-in courier's open route. */
  private async ownStop(stopId: string) {
    const courier = await this.courier();
    if (!courier) throw new ForbiddenError('Seu usuário não está vinculado a um entregador');
    const stop = await this.db.deliveryStop.findFirst({
      where: { id: stopId, run: { openCourierId: courier.id } },
      include: { order: true },
    });
    if (!stop) throw new NotFoundError('Entrega');
    return stop;
  }

  async me(): Promise<CourierAppDto> {
    const courier = await this.courier();
    if (!courier) return { courier: null, run: null };
    const run = await this.db.deliveryRun.findFirst({
      where: { openCourierId: courier.id },
      include: {
        stops: {
          orderBy: { sequence: 'asc' },
          include: {
            order: {
              select: {
                number: true,
                customerName: true,
                customerPhone: true,
                deliveryAddress: true,
                notes: true,
                totalCents: true,
                paidCents: true,
                expectedPaymentMethod: true,
                changeForCents: true,
                delivery: { select: { latitude: true, longitude: true } },
              },
            },
          },
        },
      },
    });
    return {
      courier: { id: courier.id, name: courier.name },
      run: run
        ? {
            id: run.id,
            departedAt: run.departedAt.toISOString(),
            stops: run.stops.map((s): CourierAppStopDto => {
              const address = s.order.deliveryAddress as Address | null;
              return {
                stopId: s.id,
                orderNumber: s.order.number,
                status: s.deliveredAt ? 'DELIVERED' : s.failedAt ? 'FAILED' : 'PENDING',
                customerName: s.order.customerName,
                customerPhone: s.order.customerPhone,
                address,
                links: address
                  ? mapLinks({
                      ...address,
                      latitude: address.latitude ?? s.order.delivery?.latitude ?? null,
                      longitude: address.longitude ?? s.order.delivery?.longitude ?? null,
                    })
                  : null,
                notes: s.order.notes,
                chargeCents: Math.max(s.order.totalCents - s.order.paidCents, 0),
                expectedPaymentMethod: s.order.expectedPaymentMethod as PaymentMethod | null,
                changeForCents: s.order.changeForCents,
                collectedMethod: s.collectedMethod as PaymentMethod | null,
                collectedCents: s.collectedCents,
                receivedCents: s.receivedCents,
                changeCents: s.changeCents,
                failureReason: s.failureReason as DeliveryFailureReason | null,
              };
            }),
          }
        : null,
    };
  }

  /** "Entregue", optionally with how the customer paid. */
  async deliver(stopId: string, collection: Collection | null): Promise<CourierAppDto> {
    const stop = await this.ownStop(stopId);
    if (stop.deliveredAt || stop.failedAt)
      throw new ValidationError('Esta entrega já foi encerrada');
    const balance = Math.max(stop.order.totalCents - stop.order.paidCents, 0);
    if (balance > 0 && !collection) {
      throw new ValidationError('Informe como o cliente pagou');
    }
    await this.orders.changeStatus(stop.orderId, {
      expectedVersion: stop.order.version,
      status: 'DELIVERED',
      reason: 'Entregue pelo entregador',
    });
    if (collection) {
      await this.db.deliveryStop.update({
        where: { id: stopId },
        data: collectionData(collection),
      });
    }
    this.realtime.deliveryUpdated(this.ctx.tenantId);
    return this.me();
  }

  /** Corrects how the customer paid (until the settlement). */
  async setCollection(stopId: string, collection: Collection): Promise<CourierAppDto> {
    const stop = await this.ownStop(stopId);
    if (!stop.deliveredAt) throw new ValidationError('Marque a entrega como entregue antes');
    await this.db.deliveryStop.update({ where: { id: stopId }, data: collectionData(collection) });
    this.realtime.deliveryUpdated(this.ctx.tenantId);
    return this.me();
  }

  async fail(
    stopId: string,
    input: { reason: DeliveryFailureReason; note: string | null },
  ): Promise<CourierAppDto> {
    const stop = await this.ownStop(stopId);
    if (stop.deliveredAt || stop.failedAt)
      throw new ValidationError('Esta entrega já foi encerrada');
    await this.db.$transaction((tx) => this.dispatch.fail(tx, stop.orderId, input));
    await this.orders.publish(stop.orderId);
    this.realtime.deliveryUpdated(this.ctx.tenantId);
    return this.me();
  }

  /** The courier is back at the store: the route closes and waits for the settlement. */
  async returnOwn(): Promise<CourierAppDto> {
    const courier = await this.courier();
    if (!courier) throw new ForbiddenError('Seu usuário não está vinculado a um entregador');
    await this.db.$transaction(async (tx) => {
      const run = await tx.deliveryRun.findFirst({ where: { openCourierId: courier.id } });
      if (!run) throw new ValidationError('Você não está em rota');
      await closeRun(tx, run);
    });
    this.realtime.deliveryUpdated(this.ctx.tenantId);
    return this.me();
  }

  /** The operator records the return (courier without the app). */
  async returnRun(runId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const run = await tx.deliveryRun.findFirst({ where: { id: runId } });
      if (!run) throw new NotFoundError('Saída');
      if (run.status !== 'OUT') throw new ValidationError('Esta saída já foi encerrada');
      await closeRun(tx, run);
    });
    this.realtime.deliveryUpdated(this.ctx.tenantId);
  }
}

/** Closes an open run: every stop must be delivered or reported as not delivered. */
export async function closeRun(tx: DbTx, run: DeliveryRun, now = new Date()): Promise<void> {
  const pending = await tx.deliveryStop.count({
    where: { runId: run.id, deliveredAt: null, failedAt: null },
  });
  if (pending) {
    throw new ValidationError(
      pending === 1
        ? 'Ainda há 1 entrega em aberto: marque como entregue ou não entregue'
        : `Ainda há ${pending} entregas em aberto: marque como entregues ou não entregues`,
    );
  }
  await tx.deliveryRun.update({
    where: { id: run.id },
    data: { status: 'RETURNED', returnedAt: now, openCourierId: null },
  });
}
