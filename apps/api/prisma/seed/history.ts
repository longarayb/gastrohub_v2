/* eslint-disable no-console -- seed script: optional timings (SEED_TIMINGS) */
/**
 * 90 days of history for the dashboard and reports (D038): more movement on Friday and
 * Saturday, lunch and dinner peaks, products with different popularity, a few cancellations
 * (some after production, concentrated on one user so the losses report has something to
 * show), item cancellations, discounts, service fees removed, refunds and cash differences.
 *
 * Deterministic (fixed seed: same data every run) and fast: everything is built in memory with
 * the same pure functions the API uses (priceMenuItem, calculateOrderTotals, routeItem) and
 * inserted with createMany in batches. Only past business days; today stays with the live demo.
 */
import {
  type BusinessHour,
  type MenuItemPricing,
  type PaymentMethod,
  type PricedModifier,
  addDaysToDate,
  calculateOrderTotals,
  currentBusinessDay,
  defaultServiceFeeBps,
  normalizePlace,
  priceMenuItem,
  routeItem,
  timeToMinutes,
  weekdayOfDate,
  zonedTimeToInstant,
} from '@app/shared';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';

/** Small deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    chance: (p: number) => next() < p,
    pick: <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!,
    weighted: <T>(list: readonly { weight: number; value: T }[]) => {
      const total = list.reduce((t, i) => t + i.weight, 0);
      let r = next() * total;
      for (const i of list) {
        r -= i.weight;
        if (r <= 0) return i.value;
      }
      return list.at(-1)!.value;
    },
    /** Triangular distribution between min and max with the mode at `peak`. */
    triangular: (min: number, peak: number, max: number) => {
      const u = next();
      const c = (peak - min) / (max - min);
      return u < c
        ? min + Math.sqrt(u * (max - min) * (peak - min))
        : max - Math.sqrt((1 - u) * (max - min) * (max - peak));
    },
  };
}

/** Orders per business day by weekday (0 = Sunday), before the noise. */
const DAILY_ORDERS = [70, 28, 40, 45, 55, 105, 120];
const PAYMENT_MIX: { weight: number; value: PaymentMethod }[] = [
  { weight: 25, value: 'CASH' },
  { weight: 35, value: 'PIX' },
  { weight: 20, value: 'CREDIT_CARD' },
  { weight: 15, value: 'DEBIT_CARD' },
  { weight: 5, value: 'MEAL_VOUCHER' },
];
const CANCEL_REASONS = [
  'Cliente desistiu',
  'Pedido lançado errado',
  'Demora no preparo',
  'Cliente não atendeu',
  'Item em falta',
];
const ITEM_CANCEL_REASONS = ['Lançado errado', 'Acabou', 'Cliente trocou o pedido', 'Saiu frio'];
const DISCOUNT_REASONS = ['Cliente fiel', 'Cortesia da casa', 'Demora na entrega', 'Aniversário'];
const FEE_REASONS = ['Cliente pediu', 'Atendimento demorado'];

type Chunked = Record<string, unknown>;

/**
 * Fast bulk insert for the seed: each batch goes as ONE JSON parameter expanded by Postgres
 * (`jsonb_populate_recordset`), with the columns present in the rows (the others keep their
 * defaults). Much faster than row-by-row serialization for wide tables with JSON columns.
 */
async function bulkInsert(prisma: PrismaClient, table: string, rows: Chunked[]): Promise<void> {
  if (!rows.length) return;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const list = columns.map((c) => `"${c}"`).join(', ');
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = JSON.stringify(rows.slice(i, i + 2000));
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${table}" (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::"${table}", $1::jsonb)`,
      chunk,
    );
  }
}

export async function seedHistory(
  prisma: PrismaClient,
  tenantId: string,
  users: { cashierId: string; waiterId: string; managerId: string; ownerId: string },
  days = 90,
): Promise<{ orders: number; days: number }> {
  const t0 = Date.now();
  const r = rng(20261008);
  const store = await prisma.store.findUniqueOrThrow({ where: { id: tenantId } });
  const hours = (await prisma.businessHours.findMany({
    where: { tenantId },
  })) as unknown as BusinessHour[];
  const today = currentBusinessDay(hours, new Date(), store.timezone).date;

  // ---- Catalog: what can be sold, with popularity ----
  const products = await prisma.product.findMany({
    where: { tenantId, deletedAt: null },
    include: { category: true, sizePrices: { include: { size: true } } },
    orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
  });
  const links = await prisma.modifierGroupLink.findMany({
    where: { tenantId, isDisabled: false, minSelect: { gt: 0 } },
    include: {
      group: {
        include: { options: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
      },
    },
  });
  const pizzaSizes = await prisma.size.findMany({ where: { tenantId } });
  const required = (
    productId: string,
    categoryId: string,
    sizeId: string | null,
  ): PricedModifier[] =>
    links
      .filter((l) => l.productId === productId || (!l.productId && l.categoryId === categoryId))
      .flatMap((l) => {
        const option = l.group.options[Math.min(1, l.group.options.length - 1)];
        if (!option) return [];
        const combo = option.productId
          ? products.find((p) => p.id === option.productId)
          : undefined;
        void sizeId;
        return [
          {
            groupId: l.groupId,
            groupName: l.group.name,
            optionId: option.id,
            name: combo?.name ?? option.name,
            quantity: Math.max(1, l.minSelect),
            unitPriceCents: option.priceCents,
            product: combo ? { id: combo.id, name: combo.name, sectorId: combo.sectorId } : null,
            sectorId: combo?.sectorId ?? null,
          },
        ];
      });

  type Line = { weight: number; drink: boolean; make: (quantity: number) => MenuItemPricing };
  const catalog: Line[] = [];
  products.forEach((p, index) => {
    // Popularity: a long tail, shuffled by category so every category has stars and laggards.
    const weight = 1 / Math.pow((index % 9) + 1, 0.9) + r.next() * 0.3;
    const drink = /bebida/i.test(p.category.name);
    if (p.category.kind === 'PIZZA') {
      const sizes = pizzaSizes.filter((s) => s.categoryId === p.categoryId);
      for (const size of sizes) {
        const price = p.sizePrices.find((sp) => sp.sizeId === size.id);
        if (!price) continue;
        catalog.push({
          // Many flavors × sizes: pizzas weigh less each, and the family size sells less.
          weight: weight * 0.3 * (/fam[ií]lia/i.test(size.name) ? 0.4 : 1),
          drink,
          make: (quantity) =>
            priceMenuItem({
              kind: 'PIZZA',
              category: { id: p.categoryId, name: p.category.name },
              size: { id: size.id, name: size.name, maxFlavors: size.maxFlavors },
              flavors: [
                {
                  product: { id: p.id, name: p.name, sku: p.sku, sectorId: p.sectorId },
                  priceCents: price.priceCents,
                  promoPriceCents: price.promoPriceCents,
                  note: null,
                },
              ],
              rule: store.pizzaPricingRule,
              modifiers: [],
              quantity,
            }),
        });
      }
      return;
    }
    const variants = p.sizePrices.length
      ? p.sizePrices.map((sp) => ({
          size: { id: sp.sizeId, name: sp.size.name },
          price: sp.priceCents,
          promo: sp.promoPriceCents,
        }))
      : p.priceCents !== null
        ? [{ size: null, price: p.priceCents, promo: p.promoPriceCents }]
        : [];
    for (const v of variants) {
      catalog.push({
        weight: weight / variants.length,
        drink,
        make: (quantity) =>
          priceMenuItem({
            kind: p.kind,
            product: { id: p.id, name: p.name, sku: p.sku, sectorId: p.sectorId },
            categoryId: p.categoryId,
            size: v.size,
            priceCents: v.price,
            promoPriceCents: v.promo,
            modifiers: required(p.id, p.categoryId, v.size?.id ?? null),
            quantity,
          }),
      });
    }
  });
  const food = catalog.filter((c) => !c.drink).map((c) => ({ weight: c.weight, value: c }));
  const drinks = catalog.filter((c) => c.drink).map((c) => ({ weight: c.weight, value: c }));
  const defaultSector = products.find((p) => p.sectorId)?.sectorId ?? null;

  const [tables, customers, couriers, areas, sectors] = await Promise.all([
    prisma.table.findMany({ where: { tenantId } }),
    prisma.customer.findMany({ where: { tenantId }, include: { addresses: true } }),
    prisma.courier.findMany({ where: { tenantId } }),
    prisma.deliveryArea.findMany({ where: { tenantId } }),
    prisma.productionSector.findMany({ where: { tenantId } }),
  ]);
  const activeAreas = areas.filter((a) => !a.pausedUntil && !a.pausedReason);
  const areaOf = (neighborhood: string) =>
    activeAreas.find((a) =>
      a.neighborhoods.some((n) => normalizePlace(n) === normalizePlace(neighborhood)),
    ) ?? null;
  const deliverable = customers.filter(
    (c) => c.addresses[0] && areaOf(c.addresses[0].neighborhood),
  );
  if (!deliverable.length)
    throw new Error('Seed: nenhum cliente com endereço dentro de uma área ativa');
  const prepMinutes = (sectorId: string) => {
    const name = sectors.find((s) => s.id === sectorId)?.name ?? '';
    if (/bar/i.test(name)) return r.triangular(1, 3, 7);
    if (/pizz/i.test(name)) return r.triangular(8, 12, 24);
    return r.triangular(5, 9, 22);
  };

  // ---- Rows ----
  let seq = 0;
  const id = (prefix: string) => `h${prefix}${(++seq).toString(36)}`;
  const codes = new Set<string>();
  const code = () => {
    let c: string;
    do {
      c = Array.from({ length: 8 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[r.int(0, 31)]).join(
        '',
      );
    } while (codes.has(c));
    codes.add(c);
    return c;
  };
  const token = () => Array.from({ length: 32 }, () => r.int(0, 15).toString(16)).join('');

  const orders: Chunked[] = [];
  const tableSessions: Chunked[] = [];
  const sessionTables: Chunked[] = [];
  const rounds: Chunked[] = [];
  const items: Chunked[] = [];
  const tasks: Chunked[] = [];
  const history: Chunked[] = [];
  const payments: Chunked[] = [];
  const sessions: Chunked[] = [];
  const counts: Chunked[] = [];
  const runs: Chunked[] = [];
  const stops: Chunked[] = [];
  const deliveries: Chunked[] = [];
  const audits: Chunked[] = [];
  const sequences: Chunked[] = [];
  const minutesAfter = (d: Date, m: number) => new Date(d.getTime() + Math.round(m * 60_000));

  for (let offset = days; offset >= 1; offset--) {
    const date = addDaysToDate(today, -offset);
    const weekday = weekdayOfDate(date);
    const shifts = hours.filter((h) => h.weekday === weekday);
    if (!shifts.length) continue;
    // Slight growth over the period and daily noise.
    const trend = 0.9 + 0.2 * ((days - offset) / days);
    const total = Math.round(DAILY_ORDERS[weekday]! * trend * (0.85 + r.next() * 0.3));
    const lunch = shifts.find((s) => timeToMinutes(s.opensAt) < 16 * 60);
    const dinner = shifts.find((s) => timeToMinutes(s.opensAt) >= 16 * 60);
    const lunchShare = !dinner ? 1 : !lunch ? 0 : weekday === 5 || weekday === 6 ? 0.3 : 0.45;

    // Cash register of the day (cashier), closed at the end with the count.
    const sessionId = id('cs');
    const firstOpen = timeToMinutes((lunch ?? dinner)!.opensAt);
    const lastShift = dinner ?? lunch!;
    let closeMinutes = timeToMinutes(lastShift.closesAt);
    if (closeMinutes <= timeToMinutes(lastShift.opensAt)) closeMinutes += 1440;
    const openedAt = zonedTimeToInstant(date, firstOpen - 15, store.timezone);
    const closedAt = zonedTimeToInstant(date, closeMinutes + 20, store.timezone);
    const methodTotals = new Map<PaymentMethod, number>();

    let number = 0;
    for (let n = 0; n < total; n++) {
      number += 1;
      const shift = r.chance(lunchShare) ? lunch! : dinner!;
      const open = timeToMinutes(shift.opensAt);
      let close = timeToMinutes(shift.closesAt);
      if (close <= open) close += 1440;
      const isLunch = open < 16 * 60;
      const peak = isLunch ? 12 * 60 + 45 : 20 * 60 + 45;
      const at = zonedTimeToInstant(
        date,
        Math.round(r.triangular(open, Math.min(Math.max(peak, open + 30), close - 30), close - 10)),
        store.timezone,
      );

      const channel = r.weighted([
        { weight: isLunch ? 45 : 35, value: 'TABLE' as const },
        { weight: 20, value: 'COUNTER' as const },
        { weight: 25, value: 'DELIVERY' as const },
        { weight: 15, value: 'DIGITAL' as const },
      ]);
      const type =
        channel === 'TABLE'
          ? 'DINE_IN'
          : channel === 'COUNTER'
            ? 'TAKEOUT'
            : channel === 'DELIVERY' || r.chance(0.7)
              ? 'DELIVERY'
              : 'TAKEOUT';
      const source = channel === 'DIGITAL' ? 'DIGITAL_MENU' : 'POS';

      // Items.
      const lineCount = type === 'DINE_IN' ? r.int(2, 5) : r.int(1, 3);
      const lines: { pricing: MenuItemPricing; canceled: boolean; roundIndex: number }[] = [];
      const roundsCount = type === 'DINE_IN' && r.chance(0.3) ? 2 : 1;
      for (let l = 0; l < lineCount; l++) {
        const pool = l > 0 && (type === 'DINE_IN' ? r.chance(0.45) : r.chance(0.3)) ? drinks : food;
        if (!pool.length) continue;
        const line = r.weighted(pool);
        lines.push({
          pricing: line.make(r.chance(0.2) ? 2 : 1),
          canceled: r.chance(0.02),
          roundIndex: roundsCount === 2 && l >= Math.ceil(lineCount / 2) ? 1 : 0,
        });
      }
      if (!lines.length || lines.every((l) => l.canceled)) {
        number -= 1;
        continue;
      }

      const canceled = r.chance(0.03);
      const discount = !canceled && r.chance(0.05);
      const serviceFeeBps = defaultServiceFeeBps(type, {
        serviceFeeBps: store.serviceFeeBps,
        serviceFeeOrderTypes: store.serviceFeeOrderTypes,
      });
      const waived = type === 'DINE_IN' && serviceFeeBps > 0 && r.chance(0.04);
      const deliveryFeeCents = type === 'DELIVERY' ? r.pick([600, 700, 800, 900]) : 0;
      const orderDiscount = discount
        ? r.chance(0.5)
          ? { type: 'PERCENT' as const, value: 1000 }
          : { type: 'VALUE' as const, value: 500 }
        : null;
      const totals = calculateOrderTotals({
        lines: lines.map((l) => ({
          quantity: l.pricing.quantity,
          unitChargedPriceCents: l.pricing.unitChargedPriceCents,
          unitFullPriceCents: l.pricing.unitFullPriceCents,
          canceled: l.canceled,
        })),
        orderDiscount,
        serviceFeeBps: waived ? 0 : serviceFeeBps,
        deliveryFeeCents,
      });

      const orderId = id('o');
      // Deliveries go to customers inside an active area (a real order outside every area
      // needs a manual choice); takeout customers are any.
      const customer =
        type === 'DELIVERY'
          ? r.pick(deliverable)
          : type === 'DINE_IN' || !r.chance(0.7)
            ? null
            : r.pick(customers);
      const address = type === 'DELIVERY' ? (customer?.addresses[0] ?? null) : null;
      const waiter =
        type === 'DINE_IN' ? (r.chance(0.7) ? users.waiterId : users.managerId) : users.cashierId;
      // One cashier cancels more, and more often after production (for the losses report).
      const canceller = r.chance(0.6) ? users.cashierId : users.managerId;
      const afterProduction =
        canceled && (canceller === users.cashierId ? r.chance(0.7) : r.chance(0.25));
      const accepted = source === 'DIGITAL_MENU' ? minutesAfter(at, r.int(1, 4)) : at;
      const sent = minutesAfter(accepted, 1);
      const durationMinutes =
        type === 'DINE_IN' ? r.int(45, 95) : type === 'DELIVERY' ? r.int(35, 70) : r.int(12, 25);
      const delivered = minutesAfter(at, durationMinutes);
      const canceledAt = minutesAfter(at, afterProduction ? r.int(8, 20) : r.int(1, 4));
      const closedBusinessDate = date;

      // Dine-in: a table session (closed) with its waiter, for the waiters report.
      let tableSessionId: string | null = null;
      if (type === 'DINE_IN' && tables.length) {
        tableSessionId = id('ts');
        tableSessions.push({
          id: tableSessionId,
          tenantId,
          openedAt: at,
          closedAt: canceled ? canceledAt : delivered,
          waiterId: waiter,
          openedById: waiter,
          guests: r.int(1, 6),
        });
        sessionTables.push({
          id: id('tt'),
          tenantId,
          sessionId: tableSessionId,
          tableId: r.pick(tables).id,
          joinedAt: at,
          leftAt: canceled ? canceledAt : delivered,
        });
      }
      orders.push({
        id: orderId,
        tenantId,
        businessDate: date,
        number,
        publicCode: code(),
        trackingToken: token(),
        type,
        source,
        status: canceled ? 'CANCELED' : 'DELIVERED',
        version: 3,
        tableSessionId,
        tabLabel:
          type === 'DINE_IN' && r.chance(0.15) ? r.pick(['Ana', 'Bruno', 'Carla', 'Diego']) : null,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        customerPhone: customer?.phone ?? null,
        deliveryAddress: address
          ? {
              cep: address.cep,
              street: address.street,
              number: address.number,
              complement: address.complement ?? '',
              neighborhood: address.neighborhood,
              city: address.city,
              state: address.state,
              reference: address.reference ?? '',
            }
          : undefined,
        courierId: type === 'DELIVERY' && !canceled && couriers.length ? r.pick(couriers).id : null,
        subtotalCents: totals.subtotalCents,
        itemDiscountCents: totals.itemDiscountCents,
        orderDiscountType: orderDiscount?.type ?? null,
        orderDiscountValue: orderDiscount?.value ?? null,
        orderDiscountReason: orderDiscount ? r.pick(DISCOUNT_REASONS) : null,
        orderDiscountCents: totals.orderDiscountCents,
        couponDiscountCents: 0,
        serviceFeeBps,
        serviceFeeWaived: waived,
        serviceFeeWaivedReason: waived ? r.pick(FEE_REASONS) : null,
        serviceFeeCents: totals.serviceFeeCents,
        deliveryFeeCents: totals.deliveryFeeCents,
        totalCents: totals.totalCents,
        promoSavingsCents: totals.promoSavingsCents,
        paidCents: 0,
        paymentStatus: 'UNPAID',
        createdById: source === 'POS' ? waiter : null,
        acceptedAt: canceled && !afterProduction && source === 'DIGITAL_MENU' ? null : accepted,
        readyAt: canceled
          ? null
          : minutesAfter(delivered, type === 'DINE_IN' ? -durationMinutes / 2 : -10),
        dispatchedAt:
          type === 'DELIVERY' && !canceled ? minutesAfter(delivered, -r.int(15, 30)) : null,
        deliveredAt: canceled ? null : delivered,
        canceledAt: canceled ? canceledAt : null,
        closedBusinessDate,
        canceledById: canceled ? canceller : null,
        cancelReason: canceled ? r.pick(CANCEL_REASONS) : null,
        createdAt: at,
        updatedAt: canceled ? canceledAt : delivered,
      });
      history.push(
        {
          id: id('sh'),
          tenantId,
          orderId,
          fromStatus: null,
          toStatus: source === 'POS' ? 'ACCEPTED' : 'PENDING',
          userId: source === 'POS' ? waiter : null,
          createdAt: at,
        },
        {
          id: id('sh'),
          tenantId,
          orderId,
          fromStatus: 'READY',
          toStatus: canceled ? 'CANCELED' : 'DELIVERED',
          userId: canceled ? canceller : users.cashierId,
          reason: canceled ? 'Cancelado' : null,
          createdAt: canceled ? canceledAt : delivered,
        },
      );
      if (canceled) {
        audits.push({
          id: id('a'),
          tenantId,
          userId: canceller,
          action: 'order.canceled',
          entity: 'Order',
          entityId: orderId,
          createdAt: canceledAt,
        });
      }
      if (orderDiscount) {
        audits.push({
          id: id('a'),
          tenantId,
          userId: r.chance(0.6) ? users.cashierId : users.managerId,
          action: 'order.discount',
          entity: 'Order',
          entityId: orderId,
          reason: 'Desconto',
          createdAt: at,
        });
      }
      if (waived) {
        audits.push({
          id: id('a'),
          tenantId,
          userId: waiter,
          action: 'order.service_fee_removed',
          entity: 'Order',
          entityId: orderId,
          createdAt: delivered,
        });
      }

      // Rounds, items and kitchen tasks.
      const roundIds: string[] = [];
      for (let ri = 0; ri < roundsCount; ri++) {
        const roundId = id('r');
        roundIds.push(roundId);
        rounds.push({
          id: roundId,
          tenantId,
          orderId,
          number: ri + 1,
          sentAt: ri === 0 ? sent : minutesAfter(sent, 25),
          sentById: waiter,
          createdAt: ri === 0 ? at : minutesAfter(at, 24),
        });
      }
      const productionStarted = !canceled || afterProduction;
      lines.forEach((line, index) => {
        const itemId = id('i');
        const p = line.pricing;
        const sectorId = p.snapshot.sectorId ?? defaultSector;
        const roundSent = line.roundIndex === 0 ? sent : minutesAfter(sent, 25);
        const itemCanceled = line.canceled || canceled;
        const itemCanceledAt = canceled ? canceledAt : minutesAfter(roundSent, r.int(2, 10));
        items.push({
          id: itemId,
          tenantId,
          orderId,
          roundId: roundIds[line.roundIndex],
          productId: p.snapshot.productId ?? null,
          snapshot: p.snapshot as unknown as Prisma.InputJsonValue,
          name: p.snapshot.name,
          sizeName: p.snapshot.size?.name ?? null,
          quantity: p.quantity,
          unitFullPriceCents: p.unitFullPriceCents,
          unitChargedPriceCents: p.unitChargedPriceCents,
          discountCents: 0,
          totalCents: p.totalChargedCents,
          sectorId,
          status: itemCanceled ? 'CANCELED' : 'SERVED',
          sentAt: roundSent,
          servedAt: itemCanceled ? null : delivered,
          canceledAt: itemCanceled ? itemCanceledAt : null,
          canceledById: line.canceled && !canceled ? canceller : canceled ? canceller : null,
          cancelReason: line.canceled && !canceled ? r.pick(ITEM_CANCEL_REASONS) : null,
          sortOrder: index,
          createdAt: roundSent,
        });
        if (line.canceled && !canceled) {
          audits.push({
            id: id('a'),
            tenantId,
            userId: canceller,
            action: 'order.item_canceled',
            entity: 'Order',
            entityId: orderId,
            createdAt: itemCanceledAt,
          });
        }
        if (!sectorId || !productionStarted) return;
        for (const task of routeItem(p.snapshot, p.quantity, sectorId)) {
          const wait = r.triangular(0.5, 2, 9);
          const started = minutesAfter(roundSent, wait);
          const ready = minutesAfter(started, prepMinutes(task.sectorId));
          const taskCanceled = itemCanceled;
          tasks.push({
            id: id('t'),
            tenantId,
            orderId,
            orderItemId: itemId,
            roundId: roundIds[line.roundIndex],
            sectorId: task.sectorId,
            kind: task.kind,
            name: task.name,
            quantity: task.quantity,
            details: task.details as unknown as Prisma.InputJsonValue,
            status: taskCanceled ? 'CANCELED' : 'READY',
            sentAt: roundSent,
            startedAt: taskCanceled && !afterProduction ? null : started,
            readyAt: taskCanceled ? null : ready,
            canceledAt: taskCanceled ? itemCanceledAt : null,
          });
        }
      });

      if (canceled) continue;

      // Payments (tables sometimes split in two), into the day's register.
      const split = type === 'DINE_IN' && totals.totalCents > 6000 && r.chance(0.25);
      const parts = split
        ? [Math.floor(totals.totalCents / 2), Math.ceil(totals.totalCents / 2)]
        : [totals.totalCents];
      let paid = 0;
      for (const amount of parts) {
        const method = r.weighted(PAYMENT_MIX);
        const paymentId = id('p');
        const refunded = type === 'DELIVERY' && r.chance(0.006);
        const paidAt = type === 'DELIVERY' ? delivered : minutesAfter(delivered, -2);
        payments.push({
          id: paymentId,
          tenantId,
          orderId,
          method,
          amountCents: amount,
          receivedCents: method === 'CASH' ? Math.ceil(amount / 1000) * 1000 : null,
          changeCents: method === 'CASH' ? Math.ceil(amount / 1000) * 1000 - amount : null,
          status: refunded ? 'REFUNDED' : 'CONFIRMED',
          cashSessionId: sessionId,
          businessDate: date,
          createdById: users.cashierId,
          createdAt: paidAt,
          refundedAt: refunded ? minutesAfter(paidAt, 40) : null,
          refundedById: refunded ? users.managerId : null,
          refundReason: refunded ? 'Pedido chegou errado' : null,
          refundSessionId: refunded ? sessionId : null,
          refundBusinessDate: refunded ? date : null,
        });
        methodTotals.set(
          method,
          (methodTotals.get(method) ?? 0) + amount - (refunded ? amount : 0),
        );
        if (!refunded) paid += amount;
        if (refunded) {
          audits.push({
            id: id('a'),
            tenantId,
            userId: users.managerId,
            action: 'payment.refunded',
            entity: 'Order',
            entityId: orderId,
            reason: 'Pedido chegou errado',
            createdAt: minutesAfter(paidAt, 40),
          });
        }
      }
      const order = orders.at(-1)!;
      order.paidCents = paid;
      order.paymentStatus = paid >= totals.totalCents ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';

      if (type === 'DELIVERY' && order.courierId) {
        const runId = id('dr');
        runs.push({
          id: runId,
          tenantId,
          courierId: order.courierId,
          businessDate: date,
          status: 'SETTLED',
          departedAt: order.dispatchedAt,
          returnedAt: minutesAfter(delivered, 12),
          createdById: users.cashierId,
        });
        stops.push({
          id: id('ds'),
          tenantId,
          runId,
          orderId,
          sequence: 1,
          dispatchedAt: order.dispatchedAt,
          deliveredAt: delivered,
        });
        const area = address ? areaOf(address.neighborhood) : null;
        deliveries.push({
          id: id('od'),
          tenantId,
          orderId,
          areaId: area?.id ?? null,
          areaName: area?.name ?? null,
          areaSource: area ? 'AUTO' : 'NONE',
          etaMinutes: area?.etaMinutes ?? 45,
        });
      }
    }

    sequences.push({ tenantId, businessDate: date, lastNumber: number });
    // Cash count: as expected, with a few short days on the cashier's register.
    sessions.push({
      id: sessionId,
      tenantId,
      businessDate: date,
      operatorId: users.cashierId,
      status: 'CLOSED',
      openOperatorId: null,
      openingCents: 20_000,
      openedAt,
      openedById: users.cashierId,
      closedAt,
      closedById: users.cashierId,
    });
    const short = r.chance(0.08) ? -r.pick([500, 1000, 1500, 2500]) : 0;
    for (const [method, cents] of methodTotals) {
      const expected = cents + (method === 'CASH' ? 20_000 : 0);
      const difference = method === 'CASH' ? short : 0;
      counts.push({
        id: id('cc'),
        tenantId,
        sessionId,
        method,
        expectedCents: expected,
        countedCents: expected + difference,
        differenceCents: difference,
      });
    }
  }

  if (process.env.SEED_TIMINGS) console.log(`[history] gerado em ${Date.now() - t0} ms`);
  // ---- Insert (parents first) ----
  const insert = async (table: string, rows: Chunked[]) => {
    const t = Date.now();
    await bulkInsert(prisma, table, rows);
    if (process.env.SEED_TIMINGS)
      console.log(`[history] ${table}: ${rows.length} em ${Date.now() - t} ms`);
  };
  await insert('CashSession', sessions);
  await insert('TableSession', tableSessions);
  await insert('TableSessionTable', sessionTables);
  await insert('Order', orders);
  await insert('OrderRound', rounds);
  await insert('OrderItem', items);
  await insert('ProductionTask', tasks);
  await insert('OrderStatusHistory', history);
  await insert('Payment', payments);
  await insert('CashSessionCount', counts);
  await insert('DeliveryRun', runs);
  await insert('DeliveryStop', stops);
  await insert('OrderDelivery', deliveries);
  await insert('AuditLog', audits);
  await insert('OrderSequence', sequences);

  return { orders: orders.length, days: sequences.length };
}
