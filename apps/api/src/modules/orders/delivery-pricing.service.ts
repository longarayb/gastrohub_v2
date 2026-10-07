import { Injectable } from '@nestjs/common';
import {
  type Address,
  type AreaResolution,
  type CreateOrderData,
  type DeliveryAreaRule,
  type DeliveryQuoteDto,
  type OrderSource,
  Permission,
  deliveryQuote,
  feeChange,
  formatBRL,
  hasPermission,
  isAreaPaused,
  resolveDeliveryArea,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { type GeocodingProvider, InjectGeocoding } from '../../core/geocoding/geocoding.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';

/** Sources whose delivery fee comes from the marketplace (no area resolution). */
const OWN_SOURCES: readonly OrderSource[] = ['POS', 'DIGITAL_MENU', 'WAITER_APP'];

const fieldError = (path: string, message: string) =>
  new ValidationError(message, [{ path, message }]);

const hasCoordinates = (a: { latitude?: number | null; longitude?: number | null }) =>
  a.latitude != null && a.longitude != null;

/**
 * Delivery area and fee of an order (docs/DECISOES.md D029): neighborhood first, radius with
 * coordinates (customer address cache, then the geocoder), manual area when it fails. The fee
 * of the area is suggested; reducing it needs orders:discount and a reason; any change is audited.
 */
@Injectable()
export class DeliveryPricingService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store (the tenant itself) is not a tenant-scoped model.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly audit: AuditService,
    @InjectGeocoding() private readonly geocoder: GeocodingProvider,
  ) {}

  private async store() {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: { latitude: true, longitude: true, deliveryMinimumCents: true },
    });
    if (!store) throw new NotFoundError('Unidade');
    return {
      coordinates:
        store.latitude != null && store.longitude != null
          ? { latitude: store.latitude, longitude: store.longitude }
          : null,
      minimumCents: store.deliveryMinimumCents,
    };
  }

  async areas(client: Db | DbTx = this.db): Promise<DeliveryAreaRule[]> {
    return client.deliveryArea.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  /**
   * Coordinates of a delivery address, only when a radius area needs them: the address itself,
   * a saved address of the customer, then the geocoder (address only — no name or phone).
   */
  async locate(
    address: Address,
    customer: { id?: string | null; phone?: string | null },
  ): Promise<Address> {
    if (hasCoordinates(address)) return address;
    const [areas, store] = await Promise.all([this.areas(), this.store()]);
    const resolution = resolveDeliveryArea(address, areas, {
      store: store.coordinates,
      now: new Date(),
    });
    if (!(!resolution.ok && resolution.reason === 'NEEDS_COORDINATES')) return address;

    const owner = customer.id
      ? { id: customer.id }
      : customer.phone
        ? { phone: customer.phone }
        : null;
    const saved = owner
      ? await this.db.customerAddress.findFirst({
          where: {
            cep: address.cep,
            number: address.number,
            latitude: { not: null },
            customer: owner,
          },
          select: { latitude: true, longitude: true },
        })
      : null;
    if (saved && hasCoordinates(saved)) {
      return { ...address, latitude: saved.latitude, longitude: saved.longitude };
    }
    const found = await this.geocoder.geocode({
      street: address.street,
      number: address.number,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      cep: address.cep,
    });
    return found ? { ...address, ...found } : address;
  }

  /** Quote for the order composer: area, fee, time, minimum (and areas for a manual choice). */
  async quote(input: {
    address: Address;
    subtotalCents: number;
    customerAddressId?: string;
  }): Promise<DeliveryQuoteDto> {
    let address = input.address;
    if (input.customerAddressId && !hasCoordinates(address)) {
      const saved = await this.db.customerAddress.findFirst({
        where: { id: input.customerAddressId },
      });
      if (saved && hasCoordinates(saved)) {
        address = { ...address, latitude: saved.latitude, longitude: saved.longitude };
      }
    }
    address = await this.locate(address, {});
    // Cache the coordinates on the saved address of the customer.
    if (input.customerAddressId && hasCoordinates(address) && !hasCoordinates(input.address)) {
      await this.db.customerAddress.updateMany({
        where: { id: input.customerAddressId, latitude: null },
        data: { latitude: address.latitude, longitude: address.longitude },
      });
    }

    const [areas, store] = await Promise.all([this.areas(), this.store()]);
    const now = new Date();
    const coordinates = hasCoordinates(address)
      ? { latitude: address.latitude!, longitude: address.longitude! }
      : null;
    const choices = areas.map((a) => ({
      id: a.id,
      name: a.name,
      feeCents: a.feeCents,
      etaMinutes: a.etaMinutes,
      paused: isAreaPaused(a, now),
    }));
    if (areas.length === 0) {
      return {
        area: null,
        quote: null,
        message: null,
        reason: 'NO_AREAS',
        coordinates,
        distanceMeters: null,
        areas: [],
      };
    }
    const resolution = resolveDeliveryArea({ ...address, coordinates }, areas, {
      store: store.coordinates,
      now,
    });
    if (!resolution.ok) {
      return {
        area: null,
        quote: null,
        message: resolution.message,
        reason: resolution.reason,
        coordinates,
        distanceMeters: null,
        areas: choices,
      };
    }
    return {
      area: { id: resolution.area.id, name: resolution.area.name, matchedBy: resolution.matchedBy },
      quote: deliveryQuote(resolution.area, input.subtotalCents, store.minimumCents),
      message: null,
      reason: null,
      coordinates,
      distanceMeters: resolution.distanceMeters,
      areas: choices,
    };
  }

  /**
   * Inside the order creation (after the totals): resolves the area, decides the fee, records
   * the delivery data and audits a changed fee. Returns the fee to store on the order.
   */
  async apply(
    tx: DbTx,
    order: { id: string; number: number; subtotalCents: number },
    input: CreateOrderData,
    address: Address,
    source: OrderSource,
  ): Promise<number> {
    const typed = input.deliveryFeeCents;
    const coordinates = hasCoordinates(address)
      ? { latitude: address.latitude!, longitude: address.longitude! }
      : null;
    const none = async () => {
      await tx.orderDelivery.create({
        data: {
          orderId: order.id,
          areaSource: 'NONE',
          latitude: coordinates?.latitude ?? null,
          longitude: coordinates?.longitude ?? null,
        },
      });
      return typed ?? 0;
    };
    // Marketplace orders bring their own fee.
    if (!OWN_SOURCES.includes(source)) return none();
    const areas = await this.areas(tx);
    if (areas.length === 0) return none();

    const store = await this.store();
    const now = new Date();
    let resolution: AreaResolution;
    let manual = false;
    if (input.deliveryAreaId) {
      const area = areas.find((a) => a.id === input.deliveryAreaId);
      if (!area) throw fieldError('deliveryAreaId', 'Área de entrega não encontrada');
      if (isAreaPaused(area, now)) {
        throw fieldError(
          'deliveryAreaId',
          `Entrega temporariamente indisponível para ${area.name}${area.pausedReason ? ` (${area.pausedReason})` : ''}`,
        );
      }
      resolution = { ok: true, area, matchedBy: 'NEIGHBORHOOD', distanceMeters: null };
      manual = true;
    } else {
      resolution = resolveDeliveryArea({ ...address, coordinates }, areas, {
        store: store.coordinates,
        now,
      });
    }
    if (!resolution.ok) throw fieldError('deliveryAreaId', resolution.message);

    const area = resolution.area;
    const quote = deliveryQuote(area, order.subtotalCents, store.minimumCents);
    // The digital menu enforces the minimum; the operator sees the warning and decides.
    if (quote.belowMinimum && source === 'DIGITAL_MENU') {
      throw new ValidationError(
        `Pedido mínimo para entrega em ${area.name}: ${formatBRL(quote.minimumOrderCents)}`,
      );
    }
    const fee = typed ?? quote.feeCents;
    const change = feeChange(quote.feeCents, fee);
    if (change === 'REDUCE') {
      if (!hasPermission(this.ctx.role, Permission.ORDERS_DISCOUNT)) {
        throw new ForbiddenError('Você não tem permissão para reduzir a taxa de entrega');
      }
      if (!input.deliveryFeeReason) {
        throw fieldError('deliveryFeeReason', 'Informe o motivo para reduzir a taxa de entrega');
      }
    }

    await tx.orderDelivery.create({
      data: {
        orderId: order.id,
        areaId: area.id,
        areaName: area.name,
        areaSource: manual ? 'MANUAL' : 'AUTO',
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
        distanceMeters: resolution.distanceMeters,
        etaMinutes: area.etaMinutes,
        suggestedFeeCents: quote.feeCents,
        feeChangeReason: change === 'SAME' ? null : (input.deliveryFeeReason ?? null),
      },
    });
    if (change !== 'SAME') {
      await this.audit.log(
        {
          action: AuditAction.DELIVERY_FEE_CHANGED,
          entity: 'Order',
          entityId: order.id,
          reason: input.deliveryFeeReason ?? undefined,
          before: { number: order.number, suggestedFeeCents: quote.feeCents, area: area.name },
          after: { deliveryFeeCents: fee },
        },
        tx,
      );
    }
    return fee;
  }
}
