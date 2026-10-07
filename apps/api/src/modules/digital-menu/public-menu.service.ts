import { createHmac } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type Address,
  type CartLineChange,
  type CatalogDto,
  type CouponRule,
  type CreateOrderData,
  type CustomerRejectionReason,
  type DoorPaymentMethod,
  type MenuItemPricing,
  type MenuItemSnapshot,
  type PublicCartData,
  type PublicCartPreviewDto,
  type PublicDeliveryQuoteDto,
  type PublicOrderCreatedDto,
  type PublicOrderData,
  type PublicStoreDto,
  type PublicTrackingDto,
  DOOR_PAYMENT_METHODS,
  ItemPricingError,
  buildPixBrCode,
  calculateOrderTotals,
  currentBusinessDay,
  customerRejectionMessage,
  defaultServiceFeeBps,
  describeItem,
  digitalOrderLimitError,
  estimatedTime,
  formatBRL,
  formatCNPJ,
  formatPhone,
  indexCatalog,
  priceCatalogItem,
  privacyNoticeTemplate,
  privacyNoticeVersion,
  storeOpenState,
  trackingTimeline,
} from '@app/shared';
import { AppConfig } from '../../core/config/app-config.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type StorageProvider, InjectStorage } from '../../core/storage/storage.js';
import { type Db, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import type { Store } from '../../generated/prisma/client.js';
import { MenuContext } from '../menu/menu-common.js';
import { DeliveryPricingService } from '../orders/delivery-pricing.service.js';
import { OrderPricingService } from '../orders/order-pricing.service.js';
import { OrdersService } from '../orders/orders.service.js';

/** The tracking page stays available this long after the order ends. */
const TRACKING_DAYS_AFTER_END = 7;
/** Bots submit the checkout right after loading it; people (even with saved data) take longer. */
const MIN_FILL_MS = 1_500;
/** A missed address is recorded once per neighborhood in this window. */
const MISS_DEDUP_MS = 30 * 60_000;

const BOT_MESSAGE = 'Não foi possível enviar o pedido. Confira os dados e tente de novo.';

/**
 * Digital menu, public side (docs/DECISOES.md D032–D034): the restaurant, its menu, a cart
 * preview priced by the server (coupon, delivery area), the order with abuse limits and the
 * tracking page. Runs in the tenant of the slug (PublicStoreGuard).
 */
@Injectable()
export class PublicMenuService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store (the tenant itself) is not a tenant-scoped model.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly config: AppConfig,
    private readonly menu: MenuContext,
    private readonly pricing: OrderPricingService,
    private readonly deliveryPricing: DeliveryPricingService,
    private readonly orders: OrdersService,
    @InjectStorage() private readonly storage: StorageProvider,
  ) {}

  private async storeRow(): Promise<Store> {
    const store = await this.prisma.store.findUnique({ where: { id: this.ctx.tenantId } });
    if (!store) throw new NotFoundError('Restaurante');
    return store;
  }

  privacyNotice(store: Store): string {
    return (
      store.privacyNotice ??
      privacyNoticeTemplate({
        name: store.tradeName,
        legalName: store.legalName,
        cnpj: store.cnpj ? formatCNPJ(store.cnpj) : null,
        email: store.email,
        phone: store.phone ? formatPhone(store.phone) : null,
      })
    );
  }

  // ---------------------------------------------------------------------------
  // Restaurant and menu

  async store(): Promise<PublicStoreDto> {
    const [store, hours, areas] = await Promise.all([
      this.storeRow(),
      this.menu.hours(),
      this.db.deliveryArea.count({ where: { deletedAt: null } }),
    ]);
    const now = new Date();
    return {
      slug: store.slug,
      name: store.tradeName,
      description: store.menuDescription,
      logoUrl: store.logoUrl,
      coverUrl: store.menuCoverKey ? this.storage.publicUrl(store.menuCoverKey) : null,
      brandColor: store.brandColor,
      phone: store.phone,
      address:
        store.addressStreet && store.addressCity
          ? {
              street: store.addressStreet,
              number: store.addressNumber ?? '',
              neighborhood: store.addressNeighborhood ?? '',
              city: store.addressCity,
              state: store.addressState ?? '',
            }
          : null,
      timezone: store.timezone,
      hours,
      serverTime: now.toISOString(),
      openState: storeOpenState(hours, now, store.timezone),
      accepting: store.digitalMenuEnabled,
      takeoutEtaMinutes: store.takeoutEtaMinutes,
      delivers: areas > 0,
      minimumOrderCents: store.deliveryMinimumCents,
      paymentMethods: [...DOOR_PAYMENT_METHODS],
      privacyNotice: this.privacyNotice(store),
      privacyVersion: privacyNoticeVersion(this.privacyNotice(store)),
    };
  }

  /** The menu to show: availability of items, not of the store (shown apart, open/closed). */
  catalog(): Promise<CatalogDto> {
    return this.pricing.loadCatalog('DIGITAL_MENU', false);
  }

  // ---------------------------------------------------------------------------
  // Cart preview (also the check before creating the order)

  private async couponRule(code: string | null, now: Date) {
    if (!code) return { rule: null as CouponRule | null, message: null as string | null };
    const coupon = await this.db.coupon.findFirst({
      where: { code: code.trim().toUpperCase(), isActive: true },
    });
    const invalid = (message: string) => ({ rule: null, message });
    if (!coupon) return invalid('Cupom inválido');
    if (coupon.validFrom && coupon.validFrom > now) return invalid('Cupom ainda não está válido');
    if (coupon.validUntil && coupon.validUntil < now) return invalid('Cupom expirado');
    if (coupon.usageLimit != null && coupon.usedCount >= coupon.usageLimit) {
      return invalid('Cupom esgotado');
    }
    return {
      rule: {
        type: coupon.type,
        value: coupon.value,
        minOrderCents: coupon.minOrderCents,
        maxDiscountCents: coupon.maxDiscountCents,
      } as CouponRule,
      message: null,
    };
  }

  private async recordMiss(address: Address, reason: string): Promise<void> {
    const since = new Date(Date.now() - MISS_DEDUP_MS);
    const recent = await this.db.deliveryQuoteMiss.count({
      where: {
        neighborhood: { equals: address.neighborhood, mode: 'insensitive' },
        city: { equals: address.city, mode: 'insensitive' },
        createdAt: { gte: since },
      },
    });
    if (!recent) {
      await this.db.deliveryQuoteMiss.create({
        data: { neighborhood: address.neighborhood, city: address.city, reason },
      });
    }
  }

  private async deliveryQuote(
    address: Address,
    subtotalCents: number,
  ): Promise<PublicDeliveryQuoteDto> {
    const quote = await this.deliveryPricing.quote({ address, subtotalCents });
    const notOk = (message: string): PublicDeliveryQuoteDto => ({
      ok: false,
      message,
      areaName: null,
      feeCents: 0,
      etaMinutes: null,
      minimumOrderCents: 0,
      belowMinimum: false,
      freeAboveCents: null,
      missingForFreeCents: null,
    });
    if (quote.reason === 'NO_AREAS') {
      return notOk('Este restaurante não faz entregas pelo cardápio. Escolha retirar no local.');
    }
    if (!quote.area || !quote.quote) {
      await this.recordMiss(address, quote.reason ?? 'OUT_OF_AREA');
      if (quote.reason === 'PAUSED') {
        return notOk(
          `${quote.message ?? 'Entregas pausadas nesta área'}. Que tal retirar no local?`,
        );
      }
      if (quote.reason === 'NEEDS_COORDINATES') {
        return notOk(
          'Não conseguimos localizar o endereço. Confira o CEP e o número ou escolha retirar no local.',
        );
      }
      return notOk(
        `Ainda não entregamos em ${address.neighborhood}. Você pode retirar no restaurante.`,
      );
    }
    const area = quote.areas.find((a) => a.id === quote.area!.id);
    const freeAbove = area?.freeAboveCents ?? null;
    return {
      ok: true,
      message: null,
      areaName: quote.area.name,
      feeCents: quote.quote.feeCents,
      etaMinutes: quote.quote.etaMinutes,
      minimumOrderCents: quote.quote.minimumOrderCents,
      belowMinimum: quote.quote.belowMinimum,
      freeAboveCents: freeAbove,
      missingForFreeCents:
        freeAbove != null && quote.quote.feeCents > 0
          ? Math.max(freeAbove - subtotalCents, 0)
          : null,
    };
  }

  async preview(cart: PublicCartData): Promise<PublicCartPreviewDto> {
    return (await this.evaluate(cart)).preview;
  }

  private async evaluate(cart: PublicCartData, now = new Date()) {
    const [store, hours, catalog] = await Promise.all([
      this.storeRow(),
      this.menu.hours(),
      this.catalog(),
    ]);
    const index = indexCatalog(catalog);
    const priced: MenuItemPricing[] = [];
    const changes: CartLineChange[] = [];
    cart.items.forEach((item, i) => {
      try {
        priced.push(priceCatalogItem(index, item));
      } catch (error) {
        if (!(error instanceof ItemPricingError) && !(error instanceof RangeError)) throw error;
        changes.push({ key: String(i), kind: 'UNAVAILABLE', message: error.message });
      }
    });
    const lines = priced.map((p) => ({
      quantity: p.quantity,
      unitChargedPriceCents: p.unitChargedPriceCents,
      unitFullPriceCents: p.unitFullPriceCents,
    }));
    const coupon = await this.couponRule(cart.couponCode, now);
    const serviceFeeBps = defaultServiceFeeBps(cart.type, {
      serviceFeeBps: store.serviceFeeBps,
      serviceFeeOrderTypes: store.serviceFeeOrderTypes,
    });
    const base = calculateOrderTotals({ lines, coupon: coupon.rule, serviceFeeBps });
    const delivery =
      cart.type === 'DELIVERY' && cart.deliveryAddress
        ? await this.deliveryQuote(cart.deliveryAddress as Address, base.subtotalCents)
        : null;
    const totals = calculateOrderTotals({
      lines,
      coupon: coupon.rule,
      serviceFeeBps,
      deliveryFeeCents: delivery?.ok ? delivery.feeCents : 0,
    });
    const open = storeOpenState(hours, now, store.timezone);

    let blockingMessage: string | null = null;
    if (!store.digitalMenuEnabled) {
      blockingMessage = 'O restaurante não está recebendo pedidos pelo cardápio agora.';
    } else if (!open.open) {
      blockingMessage = open.nextOpening
        ? `Fechado agora. Abre ${open.nextOpening.label}.`
        : 'Fechado agora.';
    } else if (changes.length) {
      blockingMessage = 'Alguns itens não estão disponíveis. Revise o carrinho.';
    } else if (delivery && !delivery.ok) {
      blockingMessage = delivery.message;
    } else if (delivery?.belowMinimum) {
      blockingMessage = `Pedido mínimo para entrega: ${formatBRL(delivery.minimumOrderCents)}.`;
    }

    const couponApplied = !!coupon.rule && totals.couponDiscountCents > 0;
    const preview: PublicCartPreviewDto = {
      subtotalCents: totals.subtotalCents,
      discountCents: totals.itemDiscountCents + totals.orderDiscountCents,
      couponDiscountCents: totals.couponDiscountCents,
      deliveryFeeCents: totals.deliveryFeeCents,
      totalCents: totals.totalCents,
      coupon: cart.couponCode
        ? {
            code: cart.couponCode.trim().toUpperCase(),
            applied: couponApplied,
            message: coupon.message ?? totals.couponMessage,
          }
        : null,
      delivery,
      takeoutEtaMinutes: store.takeoutEtaMinutes,
      changes,
      canOrder: blockingMessage === null,
      blockingMessage,
    };
    return { preview, store, couponApplied };
  }

  // ---------------------------------------------------------------------------
  // Order

  private ipHash(ip: string): string {
    return createHmac('sha256', this.config.get('JWT_ACCESS_SECRET'))
      .update(ip)
      .digest('base64url')
      .slice(0, 22);
  }

  async create(
    input: PublicOrderData,
    meta: { ip: string; idempotencyKey: string | null },
  ): Promise<PublicOrderCreatedDto> {
    // A retry of the same order returns it (before the limits, which would count it).
    if (meta.idempotencyKey) {
      const existing = await this.db.order.findFirst({
        where: { idempotencyKey: meta.idempotencyKey },
        select: { number: true, trackingToken: true },
      });
      if (existing) return existing;
    }
    // Honeypot and fill time: bots get a generic message.
    if (input.website || Date.now() - input.formStartedAt < MIN_FILL_MS) {
      throw new ValidationError(BOT_MESSAGE);
    }

    const now = new Date();
    const { preview, store, couponApplied } = await this.evaluate(input, now);
    if (!preview.canOrder) throw new ValidationError(preview.blockingMessage ?? BOT_MESSAGE);
    if (preview.totalCents !== input.expectedTotalCents) {
      throw new ConflictError(
        'Os valores do pedido mudaram. Confira o carrinho antes de enviar.',
        preview,
      );
    }

    const phone = input.customer.phone;
    const blocked = await this.db.blockedPhone.count({ where: { phone } });
    if (blocked) {
      throw new ValidationError(
        `Não foi possível concluir o pedido pelo cardápio. Ligue para o restaurante${store.phone ? `: ${formatPhone(store.phone)}` : ''}.`,
      );
    }

    const ipHash = this.ipHash(meta.ip);
    const hours = await this.menu.hours();
    const today = currentBusinessDay(hours, now, store.timezone).date;
    const [phoneOpen, phoneDay, ipHour, storePending] = await Promise.all([
      this.db.order.count({
        where: { customerPhone: phone, status: { notIn: ['DELIVERED', 'CANCELED'] } },
      }),
      this.db.order.count({ where: { customerPhone: phone, businessDate: today } }),
      this.db.order.count({
        where: { clientIpHash: ipHash, createdAt: { gte: new Date(now.getTime() - 3_600_000) } },
      }),
      this.db.order.count({ where: { source: 'DIGITAL_MENU', status: 'PENDING' } }),
    ]);
    const limitError = digitalOrderLimitError(
      { phoneOpen, phoneDay, ipHour, storePending },
      {
        perPhoneOpen: store.digitalLimitPhoneOpen,
        perPhoneDay: store.digitalLimitPhoneDay,
        perIpHour: store.digitalLimitIpHour,
        storePending: store.digitalLimitStorePending,
      },
    );
    if (limitError) throw new ValidationError(limitError);

    const data: CreateOrderData = {
      type: input.type,
      tabLabel: null,
      customer: { name: input.customer.name, phone, document: null },
      deliveryAddress: input.type === 'DELIVERY' ? input.deliveryAddress : undefined,
      deliveryFeeReason: null,
      items: input.items,
      sendNow: true,
      orderDiscount: null,
      orderDiscountReason: null,
      couponCode: couponApplied ? input.couponCode : null,
      waiveServiceFee: false,
      serviceFeeWaivedReason: null,
      notes: input.notes,
      expectedPaymentMethod: input.expectedPaymentMethod,
      changeForCents:
        input.expectedPaymentMethod === 'CASH' ? (input.changeForCents ?? null) : null,
    };
    const order = await this.orders.create(data, {
      source: 'DIGITAL_MENU',
      idempotencyKey: meta.idempotencyKey,
      clientIpHash: ipHash,
    });

    // LGPD: the notice accepted with this order (first time) and the marketing choice.
    if (order.customerId) {
      await this.db.customer.updateMany({
        where: { id: order.customerId, privacyAcceptedAt: null },
        data: {
          privacyAcceptedAt: now,
          privacyVersion: privacyNoticeVersion(this.privacyNotice(store)),
        },
      });
      if (input.marketingOptIn) {
        await this.db.customer.update({
          where: { id: order.customerId },
          data: { marketingOptIn: true },
        });
      }
    }
    const saved = await this.db.order.findFirstOrThrow({
      where: { id: order.id },
      select: { number: true, trackingToken: true },
    });
    return saved;
  }

  // ---------------------------------------------------------------------------
  // Tracking

  private async trackedOrder(token: string) {
    const order = await this.db.order.findFirst({
      where: { trackingToken: token },
      include: { items: true, delivery: { select: { etaMinutes: true } } },
    });
    if (!order) throw new NotFoundError('Pedido');
    const ended = order.deliveredAt ?? order.canceledAt;
    if (ended && Date.now() - ended.getTime() > TRACKING_DAYS_AFTER_END * 86_400_000) {
      throw new NotFoundError('Pedido');
    }
    return order;
  }

  async track(token: string): Promise<PublicTrackingDto> {
    const [order, store] = await Promise.all([this.trackedOrder(token), this.storeRow()]);
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    const type = order.type === 'DELIVERY' ? 'DELIVERY' : 'TAKEOUT';
    const active = !['DELIVERED', 'CANCELED'].includes(order.status);
    const balance = Math.max(order.totalCents - order.paidCents, 0);
    const method = order.expectedPaymentMethod as DoorPaymentMethod | null;
    const showPix =
      method === 'PIX' &&
      active &&
      order.status !== 'PENDING' &&
      balance > 0 &&
      !!store.pixKey &&
      !!store.pixMerchantName &&
      !!store.pixMerchantCity;
    const address = order.deliveryAddress as Address | null;
    return {
      number: order.number,
      type,
      status: order.status,
      version: order.version,
      createdAt: order.createdAt.toISOString(),
      steps: trackingTimeline(type, order.status, {
        createdAt: order.createdAt.toISOString(),
        acceptedAt: iso(order.acceptedAt),
        readyAt: iso(order.readyAt),
        dispatchedAt: iso(order.dispatchedAt),
        deliveredAt: iso(order.deliveredAt),
      }),
      estimatedAt: active
        ? estimatedTime({
            type,
            createdAt: order.createdAt.toISOString(),
            acceptedAt: iso(order.acceptedAt),
            etaMinutes:
              type === 'DELIVERY'
                ? (order.delivery?.etaMinutes ?? store.takeoutEtaMinutes)
                : store.takeoutEtaMinutes,
          })
        : null,
      canceled:
        order.status === 'CANCELED'
          ? {
              message: customerRejectionMessage(
                order.customerRejectReason as CustomerRejectionReason | null,
                order.customerRejectText,
              ),
            }
          : null,
      items: order.items
        .filter((i) => i.status !== 'CANCELED')
        .map((i) => ({
          name: i.name,
          quantity: i.quantity,
          details: describeItem(i.snapshot as unknown as MenuItemSnapshot),
          totalCents: i.totalCents,
        })),
      subtotalCents: order.subtotalCents,
      discountCents: order.itemDiscountCents + order.orderDiscountCents + order.couponDiscountCents,
      deliveryFeeCents: order.deliveryFeeCents,
      totalCents: order.totalCents,
      paymentMethod: method,
      changeForCents: order.changeForCents,
      neighborhood: address?.neighborhood ?? null,
      pix: showPix
        ? {
            brCode: buildPixBrCode({
              key: store.pixKey!,
              merchantName: store.pixMerchantName!,
              merchantCity: store.pixMerchantCity!,
              amountCents: balance,
              txid: order.publicCode,
            }),
            amountCents: balance,
            txid: order.publicCode,
          }
        : null,
      pixReportedAt: iso(order.pixReportedAt),
      paid: order.paymentStatus === 'PAID',
      store: { name: store.tradeName, phone: store.phone, slug: store.slug },
    };
  }

  /**
   * "Já paguei": the customer says the PIX was paid. Marks the order "PIX informado pelo
   * cliente, conferir" (board, register, courier); the payment is confirmed only by the register.
   */
  async reportPix(token: string): Promise<PublicTrackingDto> {
    const order = await this.trackedOrder(token);
    if (order.expectedPaymentMethod !== 'PIX') {
      throw new ValidationError('Este pedido não é pago por PIX');
    }
    if (order.status === 'PENDING' || order.status === 'CANCELED') {
      throw new ValidationError('O PIX fica disponível depois que o restaurante aceitar o pedido');
    }
    if (order.paymentStatus !== 'PAID' && !order.pixReportedAt) {
      await this.db.order.updateMany({
        where: { id: order.id, pixReportedAt: null },
        data: { pixReportedAt: new Date(), version: { increment: 1 } },
      });
      await this.orders.publish(order.id);
    }
    return this.track(token);
  }
}
