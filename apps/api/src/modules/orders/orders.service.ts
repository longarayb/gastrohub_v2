import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type Address,
  type CouponRule,
  type CreateOrderData,
  type DiscountData,
  type OrderDetailDto,
  type OrderItemData,
  type OrderSource,
  type OrderStatus,
  type OrderSummaryDto,
  type OrderType,
  Permission,
  calculateOrderTotals,
  canTransition,
  closeError,
  currentBusinessDay,
  defaultServiceFeeBps,
  discountAmount,
  effectiveDeliveryFeeCents,
  effectiveServiceFeeBps,
  formatBRL,
  hasPermission,
  initialOrderStatus,
  isFinalStatus,
  isSentItem,
  onlyDigits,
  paymentSummary,
  salesChannelFor,
  transitionError,
} from '@app/shared';
import { AuditAction, AuditService } from '../../core/audit/audit.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../core/errors/domain-error.js';
import { PrismaService } from '../../core/prisma/prisma.service.js';
import { type Db, type DbTx, InjectDb } from '../../core/tenancy/db.provider.js';
import { TenantContext } from '../../core/tenancy/tenant-context.js';
import { Prisma } from '../../generated/prisma/client.js';
import { MenuContext } from '../menu/menu-common.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { OrderPricingService, type PricedOrderItem } from './order-pricing.service.js';
import { ProductionService } from './production.service.js';
import {
  type OrderDetailRow,
  newPublicCode,
  nextOrderNumber,
  orderDetailInclude,
  orderSummaryInclude,
  toOrderDetail,
  toOrderEvent,
  toOrderSummary,
} from './orders.mapper.js';

export interface CreateOrderOptions {
  source: OrderSource;
  idempotencyKey?: string | null;
}

const CONFLICT_MESSAGE =
  'Este pedido foi alterado por outra pessoa. Os dados foram atualizados; confira e tente de novo.';

const hashRequest = (input: unknown) =>
  createHash('sha256').update(JSON.stringify(input)).digest('hex');

/** Payment summary from the stored paid amount (kept in sync with the payments). */
export const paymentSummaryOf = (totalCents: number, paidCents: number) =>
  paymentSummary(
    totalCents,
    paidCents > 0 ? [{ amountCents: paidCents, status: 'CONFIRMED' }] : [],
  );

@Injectable()
export class OrdersService {
  constructor(
    @InjectDb() private readonly db: Db,
    // Store (the tenant itself) and user names are not tenant-scoped models.
    private readonly prisma: PrismaService,
    private readonly ctx: TenantContext,
    private readonly menu: MenuContext,
    private readonly pricing: OrderPricingService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
    private readonly production: ProductionService,
  ) {}

  // ---------------------------------------------------------------------------
  // Helpers

  private require(permission: Permission, message: string): void {
    if (!hasPermission(this.ctx.role, permission)) throw new ForbiddenError(message);
  }

  private async store() {
    const store = await this.prisma.store.findUnique({
      where: { id: this.ctx.tenantId },
      select: {
        timezone: true,
        serviceFeeBps: true,
        serviceFeeOrderTypes: true,
        autoAcceptDigitalOrders: true,
        digitalMenuEnabled: true,
        takeoutEtaMinutes: true,
      },
    });
    if (!store) throw new NotFoundError('Unidade');
    return store;
  }

  private async findDetail(id: string, client: Db | DbTx = this.db): Promise<OrderDetailRow> {
    const order = await client.order.findFirst({ where: { id }, include: orderDetailInclude });
    if (!order) throw new NotFoundError('Pedido');
    return order;
  }

  private async toDetail(order: OrderDetailRow): Promise<OrderDetailDto> {
    const ids = [
      ...new Set(
        [
          ...order.history.map((h) => h.userId),
          ...order.payments.flatMap((p) => [p.createdById, p.refundedById]),
        ].filter(Boolean),
      ),
    ] as string[];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    return toOrderDetail(order, new Map(users.map((u) => [u.id, u.name])));
  }

  /**
   * Applies `data` only if the order still has `expectedVersion`; bumps the version.
   * Also used by the payment and tab services of the POS (same module family).
   */
  async updateVersioned(
    tx: DbTx,
    id: string,
    expectedVersion: number,
    data: Prisma.OrderUncheckedUpdateManyInput,
  ): Promise<void> {
    const { count } = await tx.order.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) {
      const exists = await tx.order.count({ where: { id } });
      if (!exists) throw new NotFoundError('Pedido');
      throw new ConflictError(CONFLICT_MESSAGE);
    }
  }

  private async couponRule(tx: DbTx, couponId: string | null): Promise<CouponRule | null> {
    if (!couponId) return null;
    const coupon = await tx.coupon.findFirst({ where: { id: couponId } });
    return coupon
      ? {
          type: coupon.type,
          value: coupon.value,
          minOrderCents: coupon.minOrderCents,
          maxDiscountCents: coupon.maxDiscountCents,
        }
      : null;
  }

  /**
   * Recomputes and stores the order totals from its items (backend is the source of truth).
   * A change can never leave the total below what was already paid: refund first.
   */
  async recalculate(tx: DbTx, orderId: string): Promise<void> {
    const order = await tx.order.findFirst({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new NotFoundError('Pedido');
    const totals = calculateOrderTotals({
      lines: order.items.map((i) => ({
        quantity: i.quantity,
        unitChargedPriceCents: i.unitChargedPriceCents,
        unitFullPriceCents: i.unitFullPriceCents,
        discount: i.discountType ? { type: i.discountType, value: i.discountValue ?? 0 } : null,
        canceled: i.status === 'CANCELED',
      })),
      orderDiscount: order.orderDiscountType
        ? { type: order.orderDiscountType, value: order.orderDiscountValue ?? 0 }
        : null,
      coupon: await this.couponRule(tx, order.couponId),
      serviceFeeBps: effectiveServiceFeeBps(order.serviceFeeBps, order.serviceFeeWaived),
      deliveryFeeCents: effectiveDeliveryFeeCents(order.type, order.deliveryFeeCents),
    });
    if (totals.totalCents < order.paidCents) {
      throw new ValidationError(
        `O total ficaria abaixo do valor já pago (${formatBRL(order.paidCents)}). Estorne um pagamento antes.`,
      );
    }
    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotalCents: totals.subtotalCents,
        itemDiscountCents: totals.itemDiscountCents,
        orderDiscountCents: totals.orderDiscountCents,
        couponDiscountCents: totals.couponDiscountCents,
        serviceFeeCents: totals.serviceFeeCents,
        totalCents: totals.totalCents,
        promoSavingsCents: totals.promoSavingsCents,
        paymentStatus: paymentSummaryOf(totals.totalCents, order.paidCents).status,
      },
    });
  }

  private async defaultSectorId(tx: DbTx): Promise<string | null> {
    const sector = await tx.productionSector.findFirst({
      where: { isDefault: true },
      select: { id: true },
    });
    return sector?.id ?? null;
  }

  /** Builds item rows for a round; checks the discount permission. */
  private itemRows(
    priced: PricedOrderItem[],
    roundId: string,
    orderId: string,
    sent: boolean,
    defaultSectorId: string | null,
    now: Date,
  ): Prisma.OrderItemUncheckedCreateInput[] {
    return priced.map(({ input, pricing, productId }, index) => {
      if (input.discount) {
        this.require(Permission.ORDERS_DISCOUNT, 'Você não tem permissão para dar desconto');
        if (!input.discountReason)
          throw new ValidationError('Informe o motivo do desconto do item');
      }
      const gross = pricing.totalChargedCents;
      const discountCents = discountAmount(gross, input.discount);
      return {
        orderId,
        roundId,
        productId,
        snapshot: pricing.snapshot as unknown as Prisma.InputJsonValue,
        name: pricing.snapshot.name,
        sizeName: pricing.snapshot.size?.name ?? null,
        quantity: pricing.quantity,
        unitFullPriceCents: pricing.unitFullPriceCents,
        unitChargedPriceCents: pricing.unitChargedPriceCents,
        discountType: input.discount?.type ?? null,
        discountValue: input.discount?.value ?? null,
        discountReason: input.discountReason ?? null,
        discountCents,
        totalCents: gross - discountCents,
        sectorId: pricing.snapshot.sectorId ?? defaultSectorId,
        status: sent ? 'QUEUED' : 'DRAFT',
        sentAt: sent ? now : null,
        notes: input.notes ?? null,
        sortOrder: index,
      };
    });
  }

  private async sectorIdsOf(orderId: string): Promise<string[]> {
    const [items, tasks] = await Promise.all([
      this.db.orderItem.findMany({
        where: { orderId, sectorId: { not: null } },
        select: { sectorId: true },
      }),
      this.db.productionTask.findMany({ where: { orderId }, select: { sectorId: true } }),
    ]);
    return [...new Set([...items.map((i) => i.sectorId!), ...tasks.map((t) => t.sectorId)])];
  }

  /** Notifies realtime clients after the commit and returns the fresh detail. */
  async publish(orderId: string, created = false): Promise<OrderDetailDto> {
    const order = await this.findDetail(orderId);
    const event = toOrderEvent(order);
    const sectors = await this.sectorIdsOf(orderId);
    if (created) this.realtime.orderCreated(this.ctx.tenantId, event, sectors);
    else this.realtime.orderUpdated(this.ctx.tenantId, event, sectors);
    if (order.type === 'DINE_IN') this.realtime.tablesUpdated(this.ctx.tenantId);
    return this.toDetail(order);
  }

  // ---------------------------------------------------------------------------
  // Queries

  async list(query: {
    status?: OrderStatus[];
    type?: OrderType;
    businessDate?: string;
    board?: boolean;
    q?: string;
    tableSessionId?: string;
    receivable?: boolean;
  }): Promise<OrderSummaryDto[]> {
    const where: Prisma.OrderWhereInput = {
      ...(query.status?.length && { status: { in: query.status } }),
      ...(query.type && { type: query.type }),
      ...(query.businessDate && { businessDate: query.businessDate }),
      ...(query.tableSessionId && { tableSessionId: query.tableSessionId }),
      // Delivered deliveries with an open balance: the courier still has to settle.
      ...(query.receivable && {
        type: 'DELIVERY',
        status: 'DELIVERED',
        paymentStatus: { not: 'PAID' },
      }),
    };
    if (query.board) {
      // Open orders of any day + orders finished in the last 12 hours.
      const since = new Date(Date.now() - 12 * 3_600_000);
      where.OR = [{ status: { notIn: ['DELIVERED', 'CANCELED'] } }, { updatedAt: { gte: since } }];
    }
    if (query.q) {
      const digits = onlyDigits(query.q);
      const text = query.q.trim();
      where.AND = [
        {
          OR: [
            ...(digits
              ? [{ number: Number(digits) }, { customerPhone: { contains: digits } }]
              : []),
            { customerName: { contains: text, mode: 'insensitive' } },
            { publicCode: { equals: query.q.toUpperCase() } },
            { tabLabel: { contains: text, mode: 'insensitive' } },
          ],
        },
      ];
    }
    const orders = await this.db.order.findMany({
      where,
      include: orderSummaryInclude,
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return orders.map(toOrderSummary);
  }

  async get(id: string): Promise<OrderDetailDto> {
    return this.toDetail(await this.findDetail(id));
  }

  // ---------------------------------------------------------------------------
  // Create

  async create(input: CreateOrderData, options: CreateOrderOptions): Promise<OrderDetailDto> {
    const requestHash = options.idempotencyKey ? hashRequest(input) : null;
    if (options.idempotencyKey) {
      const existing = await this.db.order.findFirst({
        where: { idempotencyKey: options.idempotencyKey },
        select: { id: true, requestHash: true },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new ConflictError('Esta chave de idempotência já foi usada em outro pedido');
        }
        return this.get(existing.id);
      }
    }

    if (input.orderDiscount) {
      this.require(Permission.ORDERS_DISCOUNT, 'Você não tem permissão para dar desconto');
      if (!input.orderDiscountReason) throw new ValidationError('Informe o motivo do desconto');
    }
    if (input.waiveServiceFee) {
      this.require(
        Permission.ORDERS_DISCOUNT,
        'Você não tem permissão para retirar a taxa de serviço',
      );
    }

    const store = await this.store();
    const isDigital = options.source === 'DIGITAL_MENU';
    if (isDigital && !store.digitalMenuEnabled) {
      throw new ValidationError('O cardápio digital não está recebendo pedidos no momento');
    }
    const catalog = await this.pricing.loadCatalog(
      salesChannelFor(input.type, options.source),
      isDigital,
    );
    const priced = this.pricing.priceItems(catalog, input.items);

    let orderId: string;
    try {
      orderId = await this.db.$transaction(async (tx) => {
        const now = new Date();
        const tenantId = this.ctx.tenantId;
        const hours = await this.menu.hours();
        const businessDay = currentBusinessDay(hours, now, store.timezone);

        const tableSessionId =
          input.type === 'DINE_IN' ? await this.resolveTableSession(tx, input) : null;
        const customer = await this.resolveCustomer(tx, input);
        const coupon = input.couponCode
          ? await this.reserveCoupon(tx, input.couponCode, now)
          : null;

        const status = initialOrderStatus(options.source, store.autoAcceptDigitalOrders);
        const serviceFeeBps = defaultServiceFeeBps(input.type, {
          serviceFeeBps: store.serviceFeeBps,
          serviceFeeOrderTypes: store.serviceFeeOrderTypes,
        });
        const number = await nextOrderNumber(tx, tenantId, businessDay.date);

        const order = await tx.order.create({
          data: {
            businessDate: businessDay.date,
            number,
            publicCode: newPublicCode(),
            type: input.type,
            source: options.source,
            status,
            idempotencyKey: options.idempotencyKey ?? null,
            requestHash,
            tableSessionId,
            tabLabel: input.tabLabel ?? null,
            customerId: customer?.id ?? null,
            customerName: customer?.name ?? null,
            customerPhone: customer?.phone ?? null,
            customerDocument: customer?.document ?? null,
            deliveryAddress:
              input.type === 'DELIVERY' && input.deliveryAddress
                ? (input.deliveryAddress as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
            deliveryFeeCents: effectiveDeliveryFeeCents(input.type, input.deliveryFeeCents),
            orderDiscountType: input.orderDiscount?.type ?? null,
            orderDiscountValue: input.orderDiscount?.value ?? null,
            orderDiscountReason: input.orderDiscount ? input.orderDiscountReason : null,
            couponId: coupon?.id ?? null,
            couponCode: coupon?.code ?? null,
            serviceFeeBps,
            serviceFeeWaived: input.waiveServiceFee && serviceFeeBps > 0,
            serviceFeeWaivedReason: input.waiveServiceFee ? input.serviceFeeWaivedReason : null,
            expectedPaymentMethod: input.expectedPaymentMethod ?? null,
            changeForCents: input.changeForCents ?? null,
            notes: input.notes ?? null,
            estimatedReadyAt:
              input.type === 'TAKEOUT'
                ? new Date(now.getTime() + store.takeoutEtaMinutes * 60_000)
                : null,
            createdById: this.ctx.userId ?? null,
            acceptedAt: status === 'ACCEPTED' ? now : null,
          },
        });

        const send = input.type !== 'DINE_IN' || input.sendNow;
        if (priced.length) {
          const round = await tx.orderRound.create({
            data: {
              orderId: order.id,
              number: 1,
              sentAt: send ? now : null,
              sentById: send ? this.ctx.userId : null,
            },
          });
          await tx.orderItem.createMany({
            data: this.itemRows(
              priced,
              round.id,
              order.id,
              send,
              await this.defaultSectorId(tx),
              now,
            ),
          });
          if (send) {
            const sent = await tx.orderItem.findMany({ where: { roundId: round.id } });
            await this.production.createForItems(tx, sent, now);
          }
        }
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            fromStatus: null,
            toStatus: status,
            userId: this.ctx.userId ?? null,
          },
        });
        await this.recalculate(tx, order.id);

        const saved = await tx.order.findFirst({ where: { id: order.id } });
        if (coupon) {
          const totals = await this.couponCheck(tx, order.id);
          if (totals) throw new ValidationError(totals);
        }
        if (input.orderDiscount || priced.some((p) => p.input.discount)) {
          await this.audit.log(
            {
              action: AuditAction.ORDER_DISCOUNT,
              entity: 'Order',
              entityId: order.id,
              reason:
                input.orderDiscountReason ??
                priced.find((p) => p.input.discountReason)?.input.discountReason ??
                undefined,
              after: {
                number,
                orderDiscountCents: saved?.orderDiscountCents,
                itemDiscountCents: saved?.itemDiscountCents,
              },
            },
            tx,
          );
        }
        if (input.waiveServiceFee && serviceFeeBps > 0) {
          await this.audit.log(
            {
              action: AuditAction.SERVICE_FEE_REMOVED,
              entity: 'Order',
              entityId: order.id,
              reason: input.serviceFeeWaivedReason ?? undefined,
            },
            tx,
          );
        }
        return order.id;
      });
    } catch (error) {
      // Two identical requests at the same time: the loser returns the winner's order.
      if (
        options.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.db.order.findFirst({
          where: { idempotencyKey: options.idempotencyKey },
          select: { id: true, requestHash: true },
        });
        if (existing?.requestHash === requestHash) return this.get(existing.id);
      }
      throw error;
    }
    return this.publish(orderId, true);
  }

  /** Returns the coupon minimum message when the coupon gives no discount, else null. */
  private async couponCheck(tx: DbTx, orderId: string): Promise<string | null> {
    const order = await tx.order.findFirst({ where: { id: orderId }, include: { items: true } });
    if (!order?.couponId) return null;
    const rule = await this.couponRule(tx, order.couponId);
    if (rule?.minOrderCents != null && order.subtotalCents < rule.minOrderCents) {
      return 'Pedido abaixo do valor mínimo do cupom';
    }
    return null;
  }

  private async resolveTableSession(tx: DbTx, input: CreateOrderData): Promise<string> {
    if (input.tableSessionId) {
      const session = await tx.tableSession.findFirst({
        where: { id: input.tableSessionId, closedAt: null },
      });
      if (!session) throw new ValidationError('Esta mesa já foi fechada');
      return session.id;
    }
    const table = await tx.table.findFirst({ where: { id: input.tableId, isActive: true } });
    if (!table) throw new ValidationError('Mesa não encontrada');
    const open = await tx.tableSessionTable.findFirst({
      where: { tableId: table.id, leftAt: null, session: { closedAt: null } },
      select: { sessionId: true },
    });
    if (open) return open.sessionId; // another tab on an occupied table
    const session = await tx.tableSession.create({
      data: { openedById: this.ctx.userId ?? null, waiterId: this.ctx.userId ?? null },
    });
    await tx.tableSessionTable.create({ data: { sessionId: session.id, tableId: table.id } });
    return session.id;
  }

  private async resolveCustomer(tx: DbTx, input: CreateOrderData) {
    let customer = null;
    if (input.customerId) {
      customer = await tx.customer.findFirst({ where: { id: input.customerId } });
      if (!customer) throw new ValidationError('Cliente não encontrado');
    } else if (input.customer) {
      customer = await tx.customer.upsert({
        where: { tenantId_phone: { tenantId: this.ctx.tenantId, phone: input.customer.phone } },
        create: {
          name: input.customer.name,
          phone: input.customer.phone,
          document: input.customer.document,
        },
        update: {
          name: input.customer.name,
          ...(input.customer.document && { document: input.customer.document }),
        },
      });
    }
    // Remember new delivery addresses on the customer record.
    if (customer && input.type === 'DELIVERY' && input.deliveryAddress) {
      const a = input.deliveryAddress as Address;
      const known = await tx.customerAddress.findFirst({
        where: { customerId: customer.id, cep: a.cep, number: a.number },
      });
      if (!known) {
        const count = await tx.customerAddress.count({ where: { customerId: customer.id } });
        await tx.customerAddress.create({
          data: {
            customerId: customer.id,
            cep: a.cep,
            street: a.street,
            number: a.number,
            complement: a.complement || null,
            neighborhood: a.neighborhood,
            city: a.city,
            state: a.state,
            reference: a.reference || null,
            latitude: a.latitude ?? null,
            longitude: a.longitude ?? null,
            isDefault: count === 0,
          },
        });
      }
    }
    return customer;
  }

  /** Validates the coupon and atomically consumes one use (limit never exceeded). */
  private async reserveCoupon(tx: DbTx, rawCode: string, now: Date) {
    const code = rawCode.trim().toUpperCase();
    const coupon = await tx.coupon.findFirst({ where: { code, isActive: true } });
    if (!coupon) throw new ValidationError('Cupom inválido');
    if (coupon.validFrom && coupon.validFrom > now)
      throw new ValidationError('Cupom ainda não está válido');
    if (coupon.validUntil && coupon.validUntil < now) throw new ValidationError('Cupom expirado');
    const { count } = await tx.coupon.updateMany({
      where: {
        id: coupon.id,
        ...(coupon.usageLimit != null && { usedCount: { lt: coupon.usageLimit } }),
      },
      data: { usedCount: { increment: 1 } },
    });
    if (count === 0) throw new ValidationError('Cupom esgotado');
    return coupon;
  }

  // ---------------------------------------------------------------------------
  // Rounds and items

  async addItems(
    id: string,
    input: { expectedVersion: number; items: OrderItemData[]; send: boolean },
  ): Promise<OrderDetailDto> {
    const current = await this.findDetail(id);
    if (current.type !== 'DINE_IN') {
      throw new ValidationError('Somente contas de mesa recebem novas rodadas');
    }
    if (isFinalStatus(current.status)) throw new ValidationError('Esta conta já foi encerrada');

    const catalog = await this.pricing.loadCatalog(
      salesChannelFor(current.type, current.source),
      false,
    );
    const priced = this.pricing.priceItems(catalog, input.items);

    await this.db.$transaction(async (tx) => {
      const now = new Date();
      const draftRound = current.rounds.find((r) => !r.sentAt);
      const round =
        draftRound ??
        (await tx.orderRound.create({
          data: { orderId: id, number: (current.rounds.at(-1)?.number ?? 0) + 1 },
        }));
      await tx.orderItem.createMany({
        data: this.itemRows(priced, round.id, id, false, await this.defaultSectorId(tx), now),
      });
      await this.recalculate(tx, id);
      await this.updateVersioned(tx, id, input.expectedVersion, {});
      if (input.send) await this.sendDrafts(tx, id, now);
    });
    return this.publish(id);
  }

  /** Sends the pending (draft) round to the kitchen; a ready tab goes back to preparing. */
  private async sendDrafts(tx: DbTx, orderId: string, now: Date): Promise<void> {
    const drafts = await tx.orderItem.findMany({ where: { orderId, status: 'DRAFT' } });
    if (drafts.length === 0) return;
    await this.production.createForItems(tx, drafts, now);
    await tx.orderItem.updateMany({
      where: { orderId, status: 'DRAFT' },
      data: { status: 'QUEUED', sentAt: now },
    });
    await tx.orderRound.updateMany({
      where: { orderId, sentAt: null },
      data: { sentAt: now, sentById: this.ctx.userId ?? null },
    });
    const order = await tx.order.findFirst({ where: { id: orderId } });
    // A new round after the pre-bill: the table is no longer waiting for payment.
    if (order?.tableSessionId) {
      await tx.tableSession.updateMany({
        where: { id: order.tableSessionId, billRequestedAt: { not: null } },
        data: { billRequestedAt: null },
      });
    }
    if (order?.status === 'READY') {
      await tx.order.update({
        where: { id: orderId },
        data: { status: 'PREPARING', readyAt: null },
      });
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          fromStatus: 'READY',
          toStatus: 'PREPARING',
          userId: this.ctx.userId ?? null,
          reason: 'Nova rodada enviada',
        },
      });
    }
  }

  async sendRound(id: string, expectedVersion: number): Promise<OrderDetailDto> {
    await this.db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id } });
      if (!order) throw new NotFoundError('Pedido');
      if (isFinalStatus(order.status)) throw new ValidationError('Esta conta já foi encerrada');
      await this.updateVersioned(tx, id, expectedVersion, {});
      await this.sendDrafts(tx, id, new Date());
    });
    return this.publish(id);
  }

  /** Removes an item that was not sent yet (no permission needed). */
  async removeDraftItem(id: string, itemId: string, expectedVersion: number) {
    await this.db.$transaction(async (tx) => {
      const item = await tx.orderItem.findFirst({ where: { id: itemId, orderId: id } });
      if (!item) throw new NotFoundError('Item');
      if (item.status !== 'DRAFT') {
        throw new ValidationError('Este item já foi enviado; cancele-o informando o motivo');
      }
      await tx.orderItem.delete({ where: { id: itemId } });
      await this.recalculate(tx, id);
      await this.updateVersioned(tx, id, expectedVersion, {});
    });
    return this.publish(id);
  }

  /** Cancels an item already sent to the kitchen: permission, reason and audit. */
  async cancelItem(
    id: string,
    itemId: string,
    input: { expectedVersion: number; reason: string | null },
  ) {
    await this.db.$transaction(async (tx) => {
      const item = await tx.orderItem.findFirst({ where: { id: itemId, orderId: id } });
      if (!item) throw new NotFoundError('Item');
      if (item.status === 'CANCELED') throw new ValidationError('Este item já foi cancelado');
      if (item.status === 'DRAFT') {
        throw new ValidationError('Itens não enviados podem ser removidos sem cancelamento');
      }
      if (item.status === 'SERVED')
        throw new ValidationError('Item já entregue não pode ser cancelado');
      if (isSentItem(item.status)) {
        this.require(Permission.ORDERS_CANCEL, 'Você não tem permissão para cancelar itens');
        if (!input.reason) throw new ValidationError('Informe o motivo do cancelamento do item');
      }
      const order = await tx.order.findFirst({ where: { id } });
      if (!order || isFinalStatus(order.status))
        throw new ValidationError('Este pedido já foi finalizado');

      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          status: 'CANCELED',
          canceledAt: new Date(),
          canceledById: this.ctx.userId ?? null,
          cancelReason: input.reason,
        },
      });
      await this.recalculate(tx, id);
      await this.updateVersioned(tx, id, input.expectedVersion, {});
      const now = new Date();
      await this.production.cancelItems(tx, [itemId], now);
      await this.production.sync(tx, id, now);
      await this.audit.log(
        {
          action: AuditAction.ORDER_ITEM_CANCELED,
          entity: 'Order',
          entityId: id,
          reason: input.reason ?? undefined,
          before: {
            number: order.number,
            item: {
              id: item.id,
              name: item.name,
              quantity: item.quantity,
              totalCents: item.totalCents,
              status: item.status,
            },
          },
        },
        tx,
      );
    });
    return this.publish(id);
  }

  // ---------------------------------------------------------------------------
  // Status

  async changeStatus(
    id: string,
    input: { expectedVersion: number; status: OrderStatus; reason: string | null },
  ): Promise<OrderDetailDto> {
    await this.db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id }, include: { items: true } });
      if (!order) throw new NotFoundError('Pedido');
      if (order.version !== input.expectedVersion) throw new ConflictError(CONFLICT_MESSAGE);
      const error = transitionError(order.type, order.status, input.status);
      if (error) throw new ValidationError(error);

      const now = new Date();
      const data: Prisma.OrderUncheckedUpdateManyInput = { status: input.status };
      switch (input.status) {
        case 'ACCEPTED':
          data.acceptedAt = now;
          break;
        case 'READY':
          data.readyAt = now;
          await this.production.completeOrder(tx, id, now);
          await tx.orderItem.updateMany({
            where: { orderId: id, status: { in: ['QUEUED', 'PREPARING'] } },
            data: { status: 'READY', readyAt: now },
          });
          break;
        case 'DISPATCHED':
          data.dispatchedAt = now;
          await this.production.completeOrder(tx, id, now);
          break;
        case 'DELIVERED':
          if (order.items.some((i) => i.status === 'DRAFT')) {
            throw new ValidationError(
              'Há itens não enviados para a cozinha. Envie ou remova antes de fechar.',
            );
          }
          {
            // Dine-in and takeout close only with a zero balance; delivery may stay receivable.
            const unpaid = closeError(
              order.type,
              paymentSummaryOf(order.totalCents, order.paidCents),
            );
            if (unpaid) throw new ValidationError(unpaid);
          }
          data.deliveredAt = now;
          await this.production.completeOrder(tx, id, now);
          await tx.orderItem.updateMany({
            where: { orderId: id, status: { in: ['QUEUED', 'PREPARING', 'READY'] } },
            data: { status: 'SERVED', servedAt: now },
          });
          break;
        case 'CANCELED':
          this.require(Permission.ORDERS_CANCEL, 'Você não tem permissão para cancelar pedidos');
          if (!input.reason) throw new ValidationError('Informe o motivo do cancelamento');
          if (order.paidCents > 0) {
            throw new ValidationError('Estorne os pagamentos antes de cancelar o pedido');
          }
          data.canceledAt = now;
          data.canceledById = this.ctx.userId ?? null;
          data.cancelReason = input.reason;
          await this.production.cancelOrder(tx, id, now);
          if (order.couponId) {
            await tx.coupon.updateMany({
              where: { id: order.couponId, usedCount: { gt: 0 } },
              data: { usedCount: { decrement: 1 } },
            });
          }
          break;
      }
      if (!canTransition(order.type, order.status, input.status)) {
        throw new ValidationError('Transição de status inválida');
      }
      await this.updateVersioned(tx, id, input.expectedVersion, data);
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          fromStatus: order.status,
          toStatus: input.status,
          userId: this.ctx.userId ?? null,
          reason: input.reason,
        },
      });
      if (input.status === 'CANCELED') {
        await this.audit.log(
          {
            action: AuditAction.ORDER_CANCELED,
            entity: 'Order',
            entityId: id,
            reason: input.reason ?? undefined,
            before: { number: order.number, status: order.status, totalCents: order.totalCents },
          },
          tx,
        );
      }
      if (order.tableSessionId && (input.status === 'DELIVERED' || input.status === 'CANCELED')) {
        await this.closeSessionIfDone(tx, order.tableSessionId, now);
      }
    });
    return this.publish(id);
  }

  /** Closes the table session when it has no open tabs left (frees the tables). */
  async closeSessionIfDone(tx: DbTx, sessionId: string, now: Date): Promise<void> {
    const open = await tx.order.count({
      where: { tableSessionId: sessionId, status: { notIn: ['DELIVERED', 'CANCELED'] } },
    });
    if (open > 0) return;
    await tx.tableSession.update({ where: { id: sessionId }, data: { closedAt: now } });
    await tx.tableSessionTable.updateMany({
      where: { sessionId, leftAt: null },
      data: { leftAt: now },
    });
  }

  // ---------------------------------------------------------------------------
  // Discount, service fee, courier

  async setOrderDiscount(
    id: string,
    input: { expectedVersion: number; discount: DiscountData | null; reason: string | null },
  ) {
    this.require(Permission.ORDERS_DISCOUNT, 'Você não tem permissão para dar desconto');
    await this.db.$transaction(async (tx) => {
      const before = await tx.order.findFirst({ where: { id } });
      if (!before) throw new NotFoundError('Pedido');
      if (isFinalStatus(before.status)) throw new ValidationError('Este pedido já foi finalizado');
      await this.updateVersioned(tx, id, input.expectedVersion, {
        orderDiscountType: input.discount?.type ?? null,
        orderDiscountValue: input.discount?.value ?? null,
        orderDiscountReason: input.discount ? input.reason : null,
      });
      await this.recalculate(tx, id);
      const after = await tx.order.findFirst({ where: { id } });
      await this.audit.log(
        {
          action: AuditAction.ORDER_DISCOUNT,
          entity: 'Order',
          entityId: id,
          reason: input.reason ?? undefined,
          before: { orderDiscountCents: before.orderDiscountCents, totalCents: before.totalCents },
          after: { orderDiscountCents: after?.orderDiscountCents, totalCents: after?.totalCents },
        },
        tx,
      );
    });
    return this.publish(id);
  }

  /** Removes (or restores) the service fee of an order at the customer's request. */
  async setServiceFee(
    id: string,
    input: { expectedVersion: number; waived: boolean; reason: string | null },
  ) {
    this.require(
      Permission.ORDERS_DISCOUNT,
      'Você não tem permissão para alterar a taxa de serviço',
    );
    await this.db.$transaction(async (tx) => {
      const before = await tx.order.findFirst({ where: { id } });
      if (!before) throw new NotFoundError('Pedido');
      if (isFinalStatus(before.status)) throw new ValidationError('Este pedido já foi finalizado');
      if (before.serviceFeeBps === 0)
        throw new ValidationError('Este pedido não tem taxa de serviço');
      await this.updateVersioned(tx, id, input.expectedVersion, {
        serviceFeeWaived: input.waived,
        serviceFeeWaivedReason: input.waived ? input.reason : null,
      });
      await this.recalculate(tx, id);
      await this.audit.log(
        {
          action: input.waived ? AuditAction.SERVICE_FEE_REMOVED : AuditAction.SERVICE_FEE_RESTORED,
          entity: 'Order',
          entityId: id,
          reason: input.reason ?? undefined,
          before: { serviceFeeCents: before.serviceFeeCents, totalCents: before.totalCents },
        },
        tx,
      );
    });
    return this.publish(id);
  }

  async assignCourier(id: string, input: { expectedVersion: number; courierId: string | null }) {
    await this.db.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id } });
      if (!order) throw new NotFoundError('Pedido');
      if (order.type !== 'DELIVERY')
        throw new ValidationError('Entregador só em pedidos de delivery');
      if (input.courierId) {
        const courier = await tx.courier.findFirst({
          where: { id: input.courierId, isActive: true },
        });
        if (!courier) throw new ValidationError('Entregador não encontrado');
      }
      await this.updateVersioned(tx, id, input.expectedVersion, { courierId: input.courierId });
    });
    return this.publish(id);
  }
}
