/**
 * Demo orders for the current business day: every status and type, a table with two tabs and
 * two rounds, a canceled order, customers, couriers and coupons. Prices and totals come from
 * the same pure functions the API uses (priceMenuItem / calculateOrderTotals).
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  type BusinessHour,
  type CardBrand,
  type MenuItemPricing,
  type MenuItemSnapshot,
  type OrderItemStatus,
  type OrderSource,
  type OrderStatus,
  type OrderType,
  type PaymentMethod,
  type PricedModifier,
  calculateOrderTotals,
  cashSessionCount,
  cashSessionTotals,
  currentBusinessDay,
  defaultServiceFeeBps,
  paymentSummary,
  priceMenuItem,
  routeItem,
  splitEvenly,
} from '@app/shared';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const publicCode = () =>
  Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

const minutesAgo = (now: Date, minutes: number) => new Date(now.getTime() - minutes * 60_000);

/** Forward path of each type up to DELIVERED (dine-in skips DISPATCHED). */
const FLOW: Record<OrderType, OrderStatus[]> = {
  DELIVERY: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DISPATCHED', 'DELIVERED'],
  TAKEOUT: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED'],
  DINE_IN: ['PENDING', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED'],
};

const ITEM_STATUS: Record<OrderStatus, OrderItemStatus> = {
  PENDING: 'QUEUED',
  ACCEPTED: 'QUEUED',
  PREPARING: 'PREPARING',
  READY: 'READY',
  DISPATCHED: 'READY',
  DELIVERED: 'SERVED',
  CANCELED: 'CANCELED',
};

type ItemSpec = { pricing: MenuItemPricing; discount?: { cents: number; reason: string } };

interface OrderSpec {
  type: OrderType;
  source?: OrderSource;
  status: OrderStatus;
  /** Minutes since the order was created. */
  age: number;
  /** Status reached before cancellation (CANCELED orders). */
  canceledFrom?: OrderStatus;
  cancelReason?: string;
  rounds: { items: ItemSpec[]; sent: boolean; age: number }[];
  tableSessionId?: string;
  tabLabel?: string;
  customer?: { id: string; name: string; phone: string; address?: Record<string, unknown> };
  courierId?: string;
  deliveryFeeCents?: number;
  orderDiscount?: { type: 'VALUE' | 'PERCENT'; value: number; reason: string };
  coupon?: { id: string; code: string; type: 'PERCENT' | 'FIXED'; value: number };
  waiveServiceFee?: string;
  payment?: PaymentMethod;
  changeForCents?: number;
  notes?: string;
  externalDisplayId?: string;
  userId: string;
}

export async function seedOrders(
  prisma: PrismaClient,
  tenantId: string,
  users: { cashierId: string; waiterId: string; managerId: string },
): Promise<{
  orders: number;
  tables: number;
  customers: number;
  cashSessions: number;
  kitchenTasks: number;
}> {
  const store = await prisma.store.findUniqueOrThrow({ where: { id: tenantId } });
  const hours = (await prisma.businessHours.findMany({
    where: { tenantId },
  })) as unknown as BusinessHour[];
  const now = new Date();
  const businessDate = currentBusinessDay(hours, now, store.timezone).date;

  // ---- Menu lookups (pricing exactly like the API, from the seeded menu) ----
  const products = await prisma.product.findMany({
    where: { tenantId, deletedAt: null },
    include: { category: true, sizes: true, sizePrices: { include: { size: true } } },
  });
  const options = await prisma.modifierOption.findMany({
    where: { tenantId, deletedAt: null },
    include: { group: true, sizePrices: true },
  });
  const byName = (name: string) => {
    const p = products.find((x) => x.name === name);
    if (!p) throw new Error(`Produto do seed não encontrado: ${name}`);
    return p;
  };
  const modifiers = (
    list: { group: string; name: string; quantity?: number }[],
    sizeId: string | null,
  ): PricedModifier[] =>
    list.map((m) => {
      const o = options.find((x) => x.group.name === m.group && x.name === m.name);
      if (!o) throw new Error(`Complemento do seed não encontrado: ${m.group} / ${m.name}`);
      const combo = o.productId ? products.find((p) => p.id === o.productId) : undefined;
      const sized = sizeId ? o.sizePrices.find((s) => s.sizeId === sizeId) : undefined;
      return {
        groupId: o.groupId,
        groupName: o.group.name,
        optionId: o.id,
        name: o.name,
        quantity: m.quantity ?? 1,
        unitPriceCents: sized?.priceCents ?? o.priceCents,
        product: combo ? { id: combo.id, name: combo.name, sectorId: combo.sectorId } : null,
        sectorId: combo?.sectorId ?? null,
      };
    });

  const item = (
    name: string,
    opts: {
      size?: string;
      quantity?: number;
      note?: string;
      mods?: { group: string; name: string; quantity?: number }[];
    } = {},
  ): MenuItemPricing => {
    const p = byName(name);
    const sizePrice = opts.size ? p.sizePrices.find((s) => s.size.name === opts.size) : undefined;
    if (opts.size && !sizePrice)
      throw new Error(`Tamanho do seed não encontrado: ${name} ${opts.size}`);
    return priceMenuItem({
      kind: p.kind,
      product: { id: p.id, name: p.name, sku: p.sku, sectorId: p.sectorId },
      categoryId: p.categoryId,
      size: sizePrice ? { id: sizePrice.sizeId, name: sizePrice.size.name } : null,
      priceCents: sizePrice ? sizePrice.priceCents : p.priceCents!,
      promoPriceCents: sizePrice ? sizePrice.promoPriceCents : p.promoPriceCents,
      modifiers: modifiers(opts.mods ?? [], sizePrice?.sizeId ?? null),
      quantity: opts.quantity ?? 1,
      note: opts.note ?? null,
    });
  };

  const pizzaCategory = products.find((p) => p.category.kind === 'PIZZA')!.category;
  const pizzaSizes = await prisma.size.findMany({
    where: { tenantId, categoryId: pizzaCategory.id },
  });
  const pizza = (sizeName: string, flavors: string[], crust?: string): MenuItemPricing => {
    const size = pizzaSizes.find((s) => s.name === sizeName)!;
    return priceMenuItem({
      kind: 'PIZZA',
      category: { id: pizzaCategory.id, name: pizzaCategory.name },
      size: { id: size.id, name: size.name, maxFlavors: size.maxFlavors },
      flavors: flavors.map((f) => {
        const p = byName(f);
        const price = p.sizePrices.find((s) => s.sizeId === size.id)!;
        return {
          product: { id: p.id, name: p.name, sku: p.sku, sectorId: p.sectorId },
          priceCents: price.priceCents,
          promoPriceCents: price.promoPriceCents,
          note: null,
        };
      }),
      rule: store.pizzaPricingRule,
      modifiers: crust ? modifiers([{ group: 'Borda', name: crust }], size.id) : [],
      quantity: 1,
    });
  };

  // ---- Tables, customers, couriers, coupons ----
  const salao = await prisma.area.create({ data: { tenantId, name: 'Salão', sortOrder: 0 } });
  const varanda = await prisma.area.create({ data: { tenantId, name: 'Varanda', sortOrder: 1 } });
  const tables = [];
  for (let n = 1; n <= 12; n++) {
    tables.push(
      await prisma.table.create({
        data: {
          tenantId,
          name: String(n),
          areaId: n <= 8 ? salao.id : varanda.id,
          seats: n <= 8 ? 4 : 2,
          sortOrder: n,
        },
      }),
    );
  }

  const customers = [
    {
      name: 'Mariana Souza',
      phone: '11991234567',
      address: {
        cep: '01311000',
        street: 'Avenida Paulista',
        number: '1500',
        complement: 'Apto 82',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        state: 'SP',
        reference: 'Portaria 24h',
      },
    },
    {
      name: 'Rafael Lima',
      phone: '11998765432',
      address: {
        cep: '01414001',
        street: 'Rua Haddock Lobo',
        number: '595',
        complement: '',
        neighborhood: 'Cerqueira César',
        city: 'São Paulo',
        state: 'SP',
        reference: '',
      },
    },
    {
      name: 'Juliana Alves',
      phone: '11987001122',
      address: {
        cep: '01305000',
        street: 'Rua Augusta',
        number: '800',
        complement: 'Casa 2',
        neighborhood: 'Consolação',
        city: 'São Paulo',
        state: 'SP',
        reference: 'Portão verde',
      },
    },
    { name: 'Pedro Santos', phone: '11976543210' },
    {
      name: 'Carla Mendes',
      phone: '11965432100',
      address: {
        cep: '01327000',
        street: 'Rua Treze de Maio',
        number: '120',
        complement: '',
        neighborhood: 'Bixiga',
        city: 'São Paulo',
        state: 'SP',
        reference: 'Ao lado da padaria',
      },
    },
  ];
  const savedCustomers = [];
  for (const c of customers) {
    const created = await prisma.customer.create({
      data: {
        tenantId,
        name: c.name,
        phone: c.phone,
        addresses: c.address
          ? { create: { tenantId, ...c.address, label: 'Casa', isDefault: true } }
          : undefined,
      },
    });
    savedCustomers.push({ id: created.id, name: c.name, phone: c.phone, address: c.address });
  }
  const [mariana, rafael, juliana, pedro, carla] = savedCustomers as [
    (typeof savedCustomers)[number],
    (typeof savedCustomers)[number],
    (typeof savedCustomers)[number],
    (typeof savedCustomers)[number],
    (typeof savedCustomers)[number],
  ];

  const courier = await prisma.courier.create({
    data: { tenantId, name: 'Gustavo Motoboy', phone: '11955554444' },
  });
  await prisma.courier.create({ data: { tenantId, name: 'Helena Bike', phone: '11944443333' } });

  const bemVindo = await prisma.coupon.create({
    data: { tenantId, code: 'BEMVINDO10', type: 'PERCENT', value: 1000, maxDiscountCents: 2000 },
  });
  await prisma.coupon.create({
    data: { tenantId, code: 'FRETEGRATIS', type: 'FIXED', value: 800, minOrderCents: 5000 },
  });
  await prisma.coupon.create({
    data: { tenantId, code: 'NATAL', type: 'FIXED', value: 1500, isActive: false },
  });

  // ---- Orders ----
  let number = 0;
  let couponUses = 0;

  async function createOrder(spec: OrderSpec) {
    number += 1;
    const createdAt = minutesAgo(now, spec.age);
    const lines = spec.rounds.flatMap((r) => r.items);
    const serviceFeeBps = spec.waiveServiceFee
      ? 0
      : defaultServiceFeeBps(spec.type, {
          serviceFeeBps: store.serviceFeeBps,
          serviceFeeOrderTypes: store.serviceFeeOrderTypes,
        });
    const totals = calculateOrderTotals({
      lines: lines.map((l) => ({
        quantity: l.pricing.quantity,
        unitChargedPriceCents: l.pricing.unitChargedPriceCents,
        unitFullPriceCents: l.pricing.unitFullPriceCents,
        discount: l.discount ? { type: 'VALUE', value: l.discount.cents } : null,
        canceled: false,
      })),
      orderDiscount: spec.orderDiscount ?? null,
      coupon: spec.coupon ?? null,
      serviceFeeBps,
      deliveryFeeCents: spec.type === 'DELIVERY' ? (spec.deliveryFeeCents ?? 0) : 0,
    });
    if (spec.coupon) couponUses += 1;

    // History: from the initial status up to the current one, spread over the order age.
    const start: OrderStatus = (spec.source ?? 'POS') === 'POS' ? 'ACCEPTED' : 'PENDING';
    const target = spec.status === 'CANCELED' ? (spec.canceledFrom ?? start) : spec.status;
    const flow = FLOW[spec.type];
    const path = flow.slice(flow.indexOf(start), flow.indexOf(target) + 1);
    if (spec.status === 'CANCELED') path.push('CANCELED');
    const step = spec.age / Math.max(path.length, 1);
    const at = (i: number) => minutesAgo(now, spec.age - step * i);
    const reached = (s: OrderStatus) => {
      const i = path.indexOf(s);
      return i >= 0 ? at(i) : null;
    };

    const order = await prisma.order.create({
      data: {
        tenantId,
        businessDate,
        number,
        publicCode: publicCode(),
        trackingToken: randomBytes(16).toString('base64url'),
        type: spec.type,
        source: spec.source ?? 'POS',
        status: spec.status,
        version: path.length - 1,
        externalId: spec.externalDisplayId ? `demo-${number}` : null,
        externalDisplayId: spec.externalDisplayId ?? null,
        tableSessionId: spec.tableSessionId ?? null,
        tabLabel: spec.tabLabel ?? null,
        customerId: spec.customer?.id ?? null,
        customerName: spec.customer?.name ?? null,
        customerPhone: spec.customer?.phone ?? null,
        deliveryAddress: spec.type === 'DELIVERY' ? (spec.customer?.address as object) : undefined,
        courierId: spec.courierId ?? null,
        subtotalCents: totals.subtotalCents,
        itemDiscountCents: totals.itemDiscountCents,
        orderDiscountType: spec.orderDiscount?.type ?? null,
        orderDiscountValue: spec.orderDiscount?.value ?? null,
        orderDiscountReason: spec.orderDiscount?.reason ?? null,
        orderDiscountCents: totals.orderDiscountCents,
        couponId: spec.coupon?.id ?? null,
        couponCode: spec.coupon?.code ?? null,
        couponDiscountCents: totals.couponDiscountCents,
        serviceFeeBps: spec.waiveServiceFee ? store.serviceFeeBps : serviceFeeBps,
        serviceFeeWaived: !!spec.waiveServiceFee,
        serviceFeeWaivedReason: spec.waiveServiceFee ?? null,
        serviceFeeCents: totals.serviceFeeCents,
        deliveryFeeCents: totals.deliveryFeeCents,
        totalCents: totals.totalCents,
        promoSavingsCents: totals.promoSavingsCents,
        expectedPaymentMethod: spec.payment ?? null,
        changeForCents: spec.changeForCents ?? null,
        notes: spec.notes ?? null,
        createdById: spec.source && spec.source !== 'POS' ? null : spec.userId,
        acceptedAt: reached('ACCEPTED'),
        readyAt: reached('READY'),
        dispatchedAt: reached('DISPATCHED'),
        deliveredAt: reached('DELIVERED'),
        canceledAt: reached('CANCELED'),
        canceledById: spec.status === 'CANCELED' ? spec.userId : null,
        cancelReason: spec.cancelReason ?? null,
        createdAt,
      },
    });

    let lineIndex = 0;
    for (const [r, round] of spec.rounds.entries()) {
      const sentAt = round.sent ? minutesAgo(now, round.age) : null;
      const created = await prisma.orderRound.create({
        data: {
          tenantId,
          orderId: order.id,
          number: r + 1,
          sentAt,
          sentById: round.sent ? spec.userId : null,
          createdAt: minutesAgo(now, round.age),
        },
      });
      for (const [i, it] of round.items.entries()) {
        const line = totals.lines[lineIndex++]!;
        // A tab with a new round goes back to PREPARING: earlier rounds stay READY
        // (items are only marked served when the tab is closed).
        const status: OrderItemStatus = !round.sent
          ? 'DRAFT'
          : r > 0 && spec.status === 'PREPARING'
            ? 'PREPARING'
            : r === 0 &&
                spec.type === 'DINE_IN' &&
                spec.status === 'PREPARING' &&
                spec.rounds.length > 1
              ? 'READY'
              : ITEM_STATUS[
                  spec.status === 'CANCELED' ? (spec.canceledFrom ?? 'ACCEPTED') : spec.status
                ];
        await prisma.orderItem.create({
          data: {
            tenantId,
            orderId: order.id,
            roundId: created.id,
            productId: it.pricing.snapshot.productId,
            snapshot: it.pricing.snapshot as object,
            name: it.pricing.snapshot.name,
            sizeName: it.pricing.snapshot.size?.name ?? null,
            quantity: it.pricing.quantity,
            unitFullPriceCents: it.pricing.unitFullPriceCents,
            unitChargedPriceCents: it.pricing.unitChargedPriceCents,
            discountType: it.discount ? 'VALUE' : null,
            discountValue: it.discount?.cents ?? null,
            discountReason: it.discount?.reason ?? null,
            discountCents: line.discountCents,
            totalCents: line.totalCents,
            sectorId: it.pricing.snapshot.sectorId,
            status,
            notes: it.pricing.snapshot.note,
            sortOrder: i,
            sentAt,
            readyAt: ['READY', 'SERVED'].includes(status) ? reached('READY') : null,
            servedAt: status === 'SERVED' ? (reached('DELIVERED') ?? now) : null,
            createdAt: minutesAgo(now, round.age),
          },
        });
      }
    }

    for (const [i, s] of path.entries()) {
      await prisma.orderStatusHistory.create({
        data: {
          tenantId,
          orderId: order.id,
          fromStatus: i === 0 ? null : path[i - 1],
          toStatus: s,
          userId: i === 0 && start === 'PENDING' ? null : spec.userId,
          reason: s === 'CANCELED' ? (spec.cancelReason ?? null) : null,
          createdAt: at(i),
        },
      });
    }
    return order;
  }

  const session = async (tableIds: string[], age: number) =>
    prisma.tableSession.create({
      data: {
        tenantId,
        openedAt: minutesAgo(now, age),
        waiterId: users.waiterId,
        openedById: users.waiterId,
        tables: {
          create: tableIds.map((tableId) => ({
            tenantId,
            tableId,
            joinedAt: minutesAgo(now, age),
          })),
        },
      },
    });

  const { cashierId, waiterId, managerId } = users;

  // ---- Cash registers (D024): the manager's morning register, closed further below with a
  // difference, and the cashier's register open now ----
  const morning = await prisma.cashSession.create({
    data: {
      tenantId,
      businessDate,
      operatorId: managerId,
      openOperatorId: managerId,
      openingCents: 15_000,
      openedAt: minutesAgo(now, 200),
      openedById: managerId,
    },
  });
  const current = await prisma.cashSession.create({
    data: {
      tenantId,
      businessDate,
      operatorId: cashierId,
      openOperatorId: cashierId,
      openingCents: 20_000,
      openedAt: minutesAgo(now, 95),
      openedById: cashierId,
    },
  });
  await prisma.cashMovement.createMany({
    data: [
      {
        tenantId,
        sessionId: morning.id,
        type: 'WITHDRAWAL',
        amountCents: 10_000,
        reason: 'Depósito no cofre',
        createdById: managerId,
        createdAt: minutesAgo(now, 120),
      },
      {
        tenantId,
        sessionId: current.id,
        type: 'SUPPLY',
        amountCents: 5_000,
        reason: 'Reforço de troco',
        createdById: cashierId,
        createdAt: minutesAgo(now, 60),
      },
    ],
  });

  /** Records a payment and keeps the order's paid amount and status in sync (like the API). */
  async function pay(
    order: { id: string; totalCents: number; publicCode: string },
    method: PaymentMethod,
    options: {
      age: number;
      sessionId: string | null;
      userId: string;
      amountCents?: number;
      receivedCents?: number;
      cardBrand?: CardBrand;
      authorizationCode?: string;
      externalRef?: string;
    },
  ) {
    const amountCents = options.amountCents ?? order.totalCents;
    const receivedCents = method === 'CASH' ? (options.receivedCents ?? amountCents) : null;
    await prisma.payment.create({
      data: {
        tenantId,
        orderId: order.id,
        method,
        amountCents,
        receivedCents,
        changeCents: receivedCents === null ? null : receivedCents - amountCents,
        cashSessionId: options.sessionId,
        externalRef: method === 'PIX' ? order.publicCode : (options.externalRef ?? null),
        cardBrand: options.cardBrand ?? null,
        authorizationCode: options.authorizationCode ?? null,
        createdById: options.userId,
        createdAt: minutesAgo(now, options.age),
      },
    });
    const paid = await prisma.payment.aggregate({
      where: { orderId: order.id, status: 'CONFIRMED' },
      _sum: { amountCents: true },
    });
    const paidCents = paid._sum.amountCents ?? 0;
    await prisma.order.update({
      where: { id: order.id },
      data: {
        paidCents,
        paymentStatus: paymentSummary(order.totalCents, [
          { amountCents: paidCents, status: 'CONFIRMED' },
        ]).status,
      },
    });
  }
  /** Cash handed over rounded up to the next R$ 10 (so the demo shows change). */
  const roundUp = (cents: number) => Math.ceil(cents / 1_000) * 1_000;
  const point = { group: 'Ponto da carne', name: 'Ao ponto' };

  // Finished earlier today (paid in the manager's morning register)
  const pickup = await createOrder({
    type: 'TAKEOUT',
    status: 'DELIVERED',
    age: 180,
    rounds: [
      {
        sent: true,
        age: 180,
        items: [
          { pricing: item('X-Salada', { mods: [point] }) },
          { pricing: item('Batata frita', { size: 'Meia' }) },
        ],
      },
    ],
    customer: juliana,
    payment: 'PIX',
    userId: cashierId,
  });
  await pay(pickup, 'PIX', { age: 175, sessionId: morning.id, userId: managerId });
  const delivered = await createOrder({
    type: 'DELIVERY',
    status: 'DELIVERED',
    age: 150,
    rounds: [
      {
        sent: true,
        age: 150,
        items: [
          { pricing: pizza('Grande', ['Calabresa', 'Marguerita'], 'Catupiry') },
          { pricing: item('Guaraná', { size: '2 L' }) },
        ],
      },
    ],
    customer: rafael,
    courierId: courier.id,
    deliveryFeeCents: 700,
    coupon: { id: bemVindo.id, code: bemVindo.code, type: 'PERCENT', value: 1000 },
    payment: 'CREDIT_CARD',
    userId: cashierId,
  });
  await pay(delivered, 'CREDIT_CARD', {
    age: 110,
    sessionId: morning.id,
    userId: managerId,
    cardBrand: 'MASTERCARD',
    authorizationCode: '482913',
  });
  await createOrder({
    type: 'TAKEOUT',
    status: 'CANCELED',
    canceledFrom: 'PREPARING',
    cancelReason: 'Cliente desistiu do pedido',
    age: 120,
    rounds: [{ sent: true, age: 120, items: [{ pricing: item('X-Tudo', { mods: [point] }) }] }],
    customer: pedro,
    payment: 'CASH',
    userId: cashierId,
  });

  // Table 4: closed tab with the service fee removed at the customer's request
  const closed = await session([tables[3]!.id], 140);
  const tableFour = await createOrder({
    type: 'DINE_IN',
    status: 'DELIVERED',
    age: 140,
    tableSessionId: closed.id,
    rounds: [
      {
        sent: true,
        age: 140,
        items: [
          { pricing: item('Executivo de frango grelhado', { quantity: 2 }) },
          { pricing: item('Suco natural', { size: '500 ml', quantity: 2 }) },
        ],
      },
    ],
    waiveServiceFee: 'Cliente pediu para retirar a taxa',
    userId: waiterId,
  });
  await pay(tableFour, 'CASH', {
    age: 75,
    sessionId: morning.id,
    userId: managerId,
    receivedCents: roundUp(tableFour.totalCents),
  });
  await prisma.tableSession.update({
    where: { id: closed.id },
    data: { closedAt: minutesAgo(now, 70) },
  });

  // Open board
  await createOrder({
    type: 'DELIVERY',
    source: 'DIGITAL_MENU',
    status: 'PENDING',
    age: 2,
    rounds: [
      {
        sent: true,
        age: 2,
        items: [
          {
            pricing: item('X-Bacon', {
              mods: [point, { group: 'Adicionais', name: 'Bacon', quantity: 2 }],
            }),
          },
          { pricing: item('Refrigerante cola lata') },
        ],
      },
    ],
    customer: mariana,
    deliveryFeeCents: 600,
    payment: 'CASH',
    changeForCents: 10000,
    notes: 'Interfone quebrado, ligar quando chegar',
    userId: cashierId,
  });
  // Paid in the app: settled without a cash register (never in the register's totals).
  const ifood = await createOrder({
    type: 'TAKEOUT',
    source: 'IFOOD',
    externalDisplayId: 'iFood 4821',
    status: 'PENDING',
    age: 4,
    rounds: [{ sent: true, age: 4, items: [{ pricing: pizza('Média', ['Portuguesa']) }] }],
    customer: pedro,
    payment: 'ONLINE',
    userId: cashierId,
  });
  await pay(ifood, 'ONLINE', {
    age: 4,
    sessionId: null,
    userId: cashierId,
    externalRef: 'iFood 4821',
  });
  await createOrder({
    type: 'TAKEOUT',
    status: 'ACCEPTED',
    age: 6,
    rounds: [
      {
        sent: true,
        age: 6,
        items: [
          {
            pricing: item('Combo X-Burguer', {
              mods: [point, { group: 'Escolha a bebida', name: 'Guaraná lata' }],
              note: 'sem cebola, capricha no molho',
            }),
          },
        ],
      },
    ],
    customer: juliana,
    payment: 'DEBIT_CARD',
    userId: cashierId,
  });
  await createOrder({
    type: 'DELIVERY',
    status: 'PREPARING',
    age: 18,
    rounds: [
      {
        sent: true,
        age: 18,
        items: [
          {
            pricing: pizza(
              'Família',
              ['Calabresa', 'Quatro queijos', 'Frango com catupiry'],
              'Cheddar',
            ),
          },
          { pricing: item('Refrigerante cola', { size: '2 L' }) },
        ],
      },
    ],
    customer: rafael,
    deliveryFeeCents: 700,
    orderDiscount: { type: 'VALUE', value: 500, reason: 'Atraso no último pedido' },
    payment: 'PIX',
    userId: cashierId,
  });
  await createOrder({
    type: 'DELIVERY',
    status: 'READY',
    age: 32,
    rounds: [
      {
        sent: true,
        age: 32,
        items: [
          { pricing: item('X-Burguer', { quantity: 2, mods: [point] }) },
          { pricing: item('Batata frita', { size: 'Inteira' }) },
        ],
      },
    ],
    customer: mariana,
    courierId: courier.id,
    deliveryFeeCents: 600,
    payment: 'CREDIT_CARD',
    userId: cashierId,
  });
  await createOrder({
    type: 'DELIVERY',
    status: 'DISPATCHED',
    age: 45,
    rounds: [
      {
        sent: true,
        age: 45,
        items: [
          {
            pricing: item('Açaí', {
              size: '500 ml',
              mods: [{ group: 'Coberturas', name: 'Granola' }],
            }),
          },
        ],
      },
    ],
    customer: juliana,
    courierId: courier.id,
    deliveryFeeCents: 600,
    payment: 'PIX',
    userId: cashierId,
  });
  // Back from a failed delivery (customer absent): ready to go again (seeded in delivery.ts).
  await createOrder({
    type: 'DELIVERY',
    status: 'READY',
    age: 60,
    rounds: [
      {
        sent: true,
        age: 60,
        items: [{ pricing: pizza('Grande', ['Calabresa']) }, { pricing: item('Guaraná lata') }],
      },
    ],
    customer: carla,
    deliveryFeeCents: 600,
    payment: 'CASH',
    changeForCents: 10_000,
    notes: 'Interfone quebrado: ligar ao chegar',
    userId: cashierId,
  });

  // Table 2 + 3 together: two tabs, the first with two rounds (second one preparing)
  const big = await session([tables[1]!.id, tables[2]!.id], 55);
  await createOrder({
    type: 'DINE_IN',
    status: 'PREPARING',
    age: 55,
    tableSessionId: big.id,
    tabLabel: 'Carlos',
    rounds: [
      {
        sent: true,
        age: 55,
        items: [
          { pricing: item('Chope 300 ml', { quantity: 3 }) },
          { pricing: item('Frango à passarinho') },
        ],
      },
      { sent: true, age: 12, items: [{ pricing: pizza('Grande', ['Marguerita', 'Camarão']) }] },
    ],
    userId: waiterId,
  });
  const fernanda = await createOrder({
    type: 'DINE_IN',
    status: 'READY',
    age: 50,
    tableSessionId: big.id,
    tabLabel: 'Fernanda',
    rounds: [
      {
        sent: true,
        age: 50,
        items: [
          { pricing: item('Burger vegetariano'), discount: { cents: 300, reason: 'Pão trocado' } },
          { pricing: item('Água mineral 500 ml') },
        ],
      },
    ],
    userId: waiterId,
  });
  // Half of Fernanda's tab paid by PIX (even split by 2): the tab stays open, "Pago em parte".
  await pay(fernanda, 'PIX', {
    age: 6,
    sessionId: current.id,
    userId: cashierId,
    amountCents: splitEvenly(fernanda.totalCents, 2)[0],
  });

  // Table 7: tab with a round not sent yet
  const draft = await session([tables[6]!.id], 8);
  await createOrder({
    type: 'DINE_IN',
    status: 'ACCEPTED',
    age: 8,
    tableSessionId: draft.id,
    rounds: [
      {
        sent: false,
        age: 8,
        items: [
          { pricing: item('Cerveja long neck', { quantity: 2 }) },
          { pricing: item('Batata frita', { size: 'Meia', note: 'Bem sequinha' }) },
        ],
      },
    ],
    userId: waiterId,
  });

  // Delivered by the courier, who still has to settle the cash ("Delivery a receber").
  await createOrder({
    type: 'DELIVERY',
    status: 'DELIVERED',
    age: 70,
    rounds: [
      {
        sent: true,
        age: 70,
        items: [
          { pricing: item('X-Salada', { quantity: 2, mods: [point] }) },
          { pricing: item('Guaraná', { size: '2 L' }) },
        ],
      },
    ],
    customer: mariana,
    courierId: courier.id,
    deliveryFeeCents: 600,
    payment: 'CASH',
    changeForCents: 10_000,
    userId: cashierId,
  });

  // The morning register closes with R$ 2,50 missing in cash (same rules as the API).
  const received = await prisma.payment.findMany({ where: { cashSessionId: morning.id } });
  const movements = await prisma.cashMovement.findMany({ where: { sessionId: morning.id } });
  const totals = cashSessionTotals({
    openingCents: morning.openingCents,
    movements,
    received,
    refunded: [],
  });
  const count = cashSessionCount(
    totals,
    Object.fromEntries(
      totals.methods.map((m) => [m.method, m.expectedCents - (m.method === 'CASH' ? 250 : 0)]),
    ),
  );
  await prisma.cashSession.update({
    where: { id: morning.id },
    data: {
      status: 'CLOSED',
      openOperatorId: null,
      closedAt: minutesAgo(now, 70),
      closedById: managerId,
      closingNotes: 'Faltaram moedas no troco',
      version: 1,
    },
  });
  await prisma.cashSessionCount.createMany({
    data: count.lines.map((line) => ({ tenantId, sessionId: morning.id, ...line })),
  });

  // ---- Kitchen display (D027): production tasks of every sent item, same routing as the API
  // (the combo drink goes to the bar), with statuses matching the items ----
  const TASK_STATUS: Partial<
    Record<OrderItemStatus, 'QUEUED' | 'PREPARING' | 'READY' | 'CANCELED'>
  > = {
    QUEUED: 'QUEUED',
    PREPARING: 'PREPARING',
    READY: 'READY',
    SERVED: 'READY',
    CANCELED: 'CANCELED',
  };
  const sent = await prisma.orderItem.findMany({
    where: { tenantId, status: { not: 'DRAFT' }, sectorId: { not: null } },
    include: { round: true, order: { select: { status: true, canceledAt: true } } },
  });
  let taskCount = 0;
  for (const it of sent) {
    // A canceled order strikes every task (its items keep the status they had).
    const status = it.order.status === 'CANCELED' ? 'CANCELED' : TASK_STATUS[it.status]!;
    const sentAt = it.round.sentAt ?? it.createdAt;
    const routed = routeItem(it.snapshot as unknown as MenuItemSnapshot, it.quantity, it.sectorId!);
    await prisma.productionTask.createMany({
      data: routed.map((task) => ({
        tenantId,
        orderId: it.orderId,
        orderItemId: it.id,
        roundId: it.roundId,
        sectorId: task.sectorId,
        kind: task.kind,
        name: task.name,
        quantity: task.quantity,
        details: task.details as object,
        status,
        sentAt,
        startedAt: status === 'QUEUED' || status === 'CANCELED' ? null : (it.startedAt ?? sentAt),
        readyAt: status === 'READY' ? (it.readyAt ?? it.servedAt ?? now) : null,
        canceledAt: status === 'CANCELED' ? (it.canceledAt ?? it.order.canceledAt ?? now) : null,
      })),
    });
    taskCount += routed.length;
  }
  // A kitchen TV waiting to be paired (the manager generates the code in Setores).
  const sectors = await prisma.productionSector.findMany({ where: { tenantId } });
  await prisma.kdsDevice.create({
    data: {
      tenantId,
      name: 'TV da cozinha',
      sectorIds: sectors.filter((s) => s.name !== 'Bar').map((s) => s.id),
      showsExpedition: true,
      createdById: managerId,
    },
  });

  await prisma.orderSequence.create({ data: { tenantId, businessDate, lastNumber: number } });
  await prisma.coupon.update({ where: { id: bemVindo.id }, data: { usedCount: couponUses } });

  return {
    orders: number,
    tables: tables.length,
    customers: savedCustomers.length,
    cashSessions: 2,
    kitchenTasks: taskCount,
  };
}
