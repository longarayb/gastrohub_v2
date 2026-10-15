import { Injectable, Logger } from '@nestjs/common';
import {
  type Address,
  type DispatchLocationDto,
  type OrderLocationInput,
  type OrderLocationResultDto,
  distanceMeters,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { GeocodingService } from '../../core/geocoding/geocoding.service.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const addressOf = (json: unknown): Address | null => {
  const a = json as Partial<Address> | null;
  return a?.street && a.number && a.city ? (a as Address) : null;
};
const queryOf = (a: Address) => ({
  street: a.street,
  number: a.number,
  neighborhood: a.neighborhood,
  city: a.city,
  state: a.state,
  cep: a.cep,
});

/**
 * Where each delivery goes (D048). An order without coordinates is located once, in the
 * background and one at a time (Nominatim policy): the customer's saved address first, then the
 * geocoder through the unit's cache. The operator fixes a wrong point by dragging the pin, which
 * is kept on the customer's address and in the cache.
 */
@Injectable()
export class OrderLocationService {
  private readonly logger = new Logger('OrderLocation');
  private readonly pending = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    @InjectDb() private readonly db: Db,
    // The background job runs for any unit (its own tenant context).
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly geocoding: GeocodingService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Queues orders without coordinates (each one once). */
  enqueue(tenantId: string, orderIds: readonly string[]): void {
    for (const orderId of orderIds) {
      if (this.pending.has(orderId)) continue;
      this.pending.add(orderId);
      this.chain = this.chain
        .then(() => this.ctx.run(tenantId, () => this.locate(orderId)))
        .then((found) => {
          if (found) this.realtime.deliveryUpdated(tenantId);
        })
        .catch((error: unknown) =>
          this.logger.warn(`Pedido ${orderId}: ${(error as Error).message}`),
        )
        .finally(() => this.pending.delete(orderId));
    }
  }

  /** Waits for the queue (tests). */
  async idle(): Promise<void> {
    while (this.pending.size) await this.chain;
  }

  /** Locates one order (inside a tenant context). True when coordinates were found. */
  async locate(orderId: string): Promise<boolean> {
    const order = await this.db.order.findFirst({
      where: { id: orderId },
      select: { deliveryAddress: true, customerId: true, delivery: true },
    });
    const delivery = order?.delivery;
    if (!order || !delivery || delivery.latitude != null) return false;
    const address = addressOf(order.deliveryAddress);
    const mark = (data: object) =>
      this.db.orderDelivery.update({
        where: { id: delivery.id },
        data: { geocodedAt: new Date(), ...data },
      });
    if (!address) {
      await mark({});
      return false;
    }
    const saved = order.customerId
      ? await this.db.customerAddress.findFirst({
          where: {
            customerId: order.customerId,
            cep: address.cep,
            number: address.number,
            latitude: { not: null },
          },
        })
      : null;
    if (saved?.latitude != null && saved.longitude != null) {
      await mark({
        latitude: saved.latitude,
        longitude: saved.longitude,
        geoSource: saved.geoSource ?? 'GEOCODER',
        geoPrecision: saved.geoPrecision ?? 'STREET',
      });
      return true;
    }
    const found = await this.geocoding.geocode(queryOf(address));
    if (!found) {
      await mark({});
      return false;
    }
    await mark({
      latitude: found.latitude,
      longitude: found.longitude,
      geoSource: found.source,
      geoPrecision: found.precision,
    });
    if (order.customerId) {
      await this.db.customerAddress.updateMany({
        where: {
          customerId: order.customerId,
          cep: address.cep,
          number: address.number,
          latitude: null,
        },
        data: {
          latitude: found.latitude,
          longitude: found.longitude,
          geoSource: found.source,
          geoPrecision: found.precision,
        },
      });
    }
    return true;
  }

  /** The operator dragged the pin (or clicked the point of an order without location). */
  async correct(orderId: string, input: OrderLocationInput): Promise<OrderLocationResultDto> {
    const order = await this.db.order.findFirst({
      where: { id: orderId },
      select: {
        number: true,
        type: true,
        status: true,
        customerId: true,
        deliveryAddress: true,
        delivery: { include: { area: true } },
      },
    });
    if (!order) throw new NotFoundError('Pedido');
    if (order.type !== 'DELIVERY' || !order.delivery) {
      throw new ValidationError('Só pedidos de delivery têm local de entrega');
    }
    if (order.status === 'DELIVERED' || order.status === 'CANCELED') {
      throw new ValidationError('Este pedido já foi encerrado');
    }
    const point = { latitude: input.latitude, longitude: input.longitude };
    const before = order.delivery;
    await this.db.orderDelivery.update({
      where: { id: before.id },
      data: { ...point, geoSource: 'MANUAL', geoPrecision: 'HOUSE', geocodedAt: new Date() },
    });

    const address = addressOf(order.deliveryAddress);
    let savedToCustomer = false;
    if (address && input.saveToCustomer !== false) {
      await this.geocoding.remember(queryOf(address), point);
      if (order.customerId) {
        const updated = await this.db.customerAddress.updateMany({
          where: { customerId: order.customerId, cep: address.cep, number: address.number },
          data: { ...point, geoSource: 'MANUAL', geoPrecision: 'HOUSE' },
        });
        savedToCustomer = updated.count > 0;
      }
    }

    // The fee already charged stays; a radius area only warns when the point leaves it.
    let outsideArea: string | null = null;
    const area = before.area;
    if (area?.kind === 'RADIUS' && area.radiusMeters) {
      const store = await this.prisma.store.findUnique({
        where: { id: this.ctx.tenantId },
        select: { latitude: true, longitude: true },
      });
      if (store?.latitude != null && store.longitude != null) {
        const meters = distanceMeters(
          { latitude: store.latitude, longitude: store.longitude },
          point,
        );
        if (meters > area.radiusMeters) {
          outsideArea = `O novo ponto fica fora da área ${area.name} (${(meters / 1000).toFixed(1)} km). A taxa cobrada não muda.`;
        }
      }
    }

    await this.audit.log({
      action: AuditAction.DELIVERY_LOCATION_CORRECTED,
      entity: 'Order',
      entityId: orderId,
      before: { number: order.number, latitude: before.latitude, longitude: before.longitude },
      after: { ...point, savedToCustomer },
    });
    this.realtime.deliveryUpdated(this.ctx.tenantId);
    const location: DispatchLocationDto = { ...point, source: 'MANUAL', precision: 'HOUSE' };
    return { location, outsideArea, savedToCustomer };
  }
}
