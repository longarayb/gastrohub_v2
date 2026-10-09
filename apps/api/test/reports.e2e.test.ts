import { addDaysToDate } from '@app/shared';
import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

type Headers = { Authorization: string };
type Order = {
  id: string;
  version: number;
  number: number;
  totalCents: number;
  payments: { id: string }[];
};

/**
 * Reports (D038): the day dashboard reconciles exactly with the cash registers and the delivery
 * report; orders count on the day they were concluded; losses and times come from the same data.
 */
describe('Reports: day dashboard, reconciliation, period, losses, times and network (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let owner: Headers;
  let manager: Headers;
  let cashier: Headers;
  let today = '';
  let yesterday = '';
  const ids: Record<string, string> = {};
  const o: Record<string, Order> = {};

  const post = (h: Headers, url: string, body: object = {}) =>
    ctx.http().post(url).set(h).send(body);
  const get = (h: Headers, url: string) => ctx.http().get(url).set(h);
  const put = (h: Headers, url: string, body: object) => ctx.http().put(url).set(h).send(body);
  const item = (quantity = 1) => ({ productId: ids.burger, quantity });
  const address = {
    cep: '01310100',
    street: 'Avenida Paulista',
    number: '1000',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
  };

  async function login(email: string): Promise<Headers> {
    const res = await post(bearer(''), '/api/auth/login', { email, password: 'Senha1234' }).expect(
      200,
    );
    return bearer(res.body.accessToken);
  }
  const order = async (body: object): Promise<Order> =>
    (await post(owner, '/api/orders', body).expect(201)).body;
  const reload = async (x: Order): Promise<Order> =>
    (await get(owner, `/api/orders/${x.id}`).expect(200)).body;
  async function pay(x: Order, method: string, amountCents: number): Promise<Order> {
    const fresh = await reload(x);
    const body = method === 'CASH' ? { receivedCents: amountCents } : {};
    return (
      await post(owner, `/api/orders/${x.id}/payments`, {
        expectedVersion: fresh.version,
        method,
        amountCents,
        ...body,
      }).expect(201)
    ).body;
  }
  async function refund(x: Order, paymentId: string): Promise<void> {
    const fresh = await reload(x);
    await post(owner, `/api/orders/${x.id}/payments/${paymentId}/refund`, {
      expectedVersion: fresh.version,
      reason: 'Cliente reclamou',
    }).expect(200);
  }
  async function advance(x: Order, statuses: string[]): Promise<Order> {
    let current = await reload(x);
    for (const status of statuses) {
      if (status === 'DISPATCHED') {
        current = (
          await post(owner, `/api/orders/${x.id}/courier`, {
            expectedVersion: current.version,
            courierId: ids.courier,
          }).expect(200)
        ).body;
      }
      current = (
        await post(owner, `/api/orders/${x.id}/status`, {
          expectedVersion: current.version,
          status,
        }).expect(200)
      ).body;
    }
    return current;
  }
  const deliver = (x: Order) => advance(x, ['PREPARING', 'READY', 'DISPATCHED', 'DELIVERED']);
  const close = (x: Order) => advance(x, ['PREPARING', 'READY', 'DELIVERED']);
  const delivery = () =>
    order({
      type: 'DELIVERY',
      customer: { name: 'Cliente Relatório', phone: '(11) 98888-7777' },
      deliveryAddress: address,
      deliveryFeeCents: 700,
      items: [item()],
    });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Cantina Relatórios' });
    owner = bearer(store.accessToken);
    // Open around the clock: the business day is the calendar day in São Paulo.
    await put(owner, '/api/stores/current/hours', { hours: [] }).expect(200);
    for (const [email, role] of [
      ['gerente.rel@teste.com', 'MANAGER'],
      ['caixa.rel@teste.com', 'CASHIER'],
    ] as const) {
      await post(owner, '/api/users', { name: role, email, role, password: 'Senha1234' }).expect(
        201,
      );
    }
    manager = await login('gerente.rel@teste.com');
    cashier = await login('caixa.rel@teste.com');
    const sector = await post(owner, '/api/menu/sectors', { name: 'Cozinha' }).expect(201);
    const category = await post(owner, '/api/menu/categories', { name: 'Lanches' }).expect(201);
    ids.burger = (
      await post(owner, '/api/menu/products', {
        categoryId: category.body.id,
        name: 'X-Burguer',
        priceCents: 2500,
        sectorId: sector.body.id,
      }).expect(201)
    ).body.id;
    ids.courier = (
      await post(owner, '/api/couriers', { name: 'Moto Relatório' }).expect(201)
    ).body.id;
    for (const n of ['1', '2', '3']) {
      ids[`table${n}`] = (await post(owner, '/api/tables', { name: n }).expect(201)).body[0].id;
    }
    today = (await get(owner, '/api/reports/day').expect(200)).body.date;
    yesterday = addDaysToDate(today, -1);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('only owners and managers see reports', async () => {
    await get(cashier, '/api/reports/day').expect(403);
    await get(manager, '/api/reports/day').expect(200);
    await get(manager, '/api/reports/day?scope=NETWORK').expect(403);
  });

  it('builds a day with every case of the reconciliation', async () => {
    // Yesterday's register: the first part of the table bill (O4) was paid then.
    const yesterdayCash = await post(owner, '/api/cash-sessions', { openingCents: 0 }).expect(201);
    o.table = await order({ type: 'DINE_IN', tableId: ids.table1, items: [item(2)] }); // 5000 + 10%
    await pay(o.table, 'CASH', 2000);
    await ctx.prisma.order.update({ where: { id: o.table.id }, data: { businessDate: yesterday } });
    await ctx.prisma.payment.updateMany({
      where: { orderId: o.table.id },
      data: { businessDate: yesterday },
    });
    await ctx.prisma.cashSession.update({
      where: { id: yesterdayCash.body.id },
      data: {
        businessDate: yesterday,
        status: 'CLOSED',
        closedAt: new Date(),
        openOperatorId: null,
      },
    });
    // A delivery concluded yesterday (receivable), paid today.
    o.lastNight = await delivery();
    o.lastNight = await deliver(o.lastNight);
    await ctx.prisma.order.update({
      where: { id: o.lastNight.id },
      data: { closedBusinessDate: yesterday, businessDate: yesterday },
    });

    await post(owner, '/api/cash-sessions', { openingCents: 10_000 }).expect(201);

    // Takeout paid in cash.
    o.takeout = await order({ type: 'TAKEOUT', items: [item(2)] });
    await pay(o.takeout, 'CASH', 5000);
    await close(o.takeout);
    // Delivery delivered, not paid: receivable.
    o.receivable = await deliver(await delivery());
    // Delivery paid by PIX, delivered, then refunded (customer complained).
    o.refunded = await delivery();
    const paidRefunded = await pay(o.refunded, 'PIX', 3200);
    await deliver(o.refunded);
    await refund(o.refunded, paidRefunded.payments[0]!.id);
    // The table: rest paid today and closed today (counts today, D038).
    await pay(o.table, 'CASH', 3500);
    await close(o.table);
    // Yesterday's delivery paid today.
    await pay(o.lastNight, 'PIX', 3200);
    // Open table with a partial payment.
    o.open = await order({ type: 'DINE_IN', tableId: ids.table2, items: [item()] });
    await pay(o.open, 'CASH', 1000);
    // Paid, refunded and canceled.
    o.canceled = await order({ type: 'TAKEOUT', items: [item()] });
    const paidCanceled = await pay(o.canceled, 'PIX', 2500);
    await refund(o.canceled, paidCanceled.payments[0]!.id);
    const fresh = await reload(o.canceled);
    await post(owner, `/api/orders/${o.canceled.id}/status`, {
      expectedVersion: fresh.version,
      status: 'CANCELED',
      reason: 'Cliente desistiu',
    }).expect(200);
    // Discount and service fee removed.
    o.discount = await order({
      type: 'TAKEOUT',
      items: [item()],
      orderDiscount: { type: 'VALUE', value: 500 },
      orderDiscountReason: 'Cliente fiel',
    });
    await pay(o.discount, 'CASH', 2000);
    await close(o.discount);
    o.noFee = await order({
      type: 'DINE_IN',
      tableId: ids.table3,
      items: [item()],
      waiveServiceFee: true,
      serviceFeeWaivedReason: 'Cliente pediu',
    });
    await pay(o.noFee, 'CASH', 2500);
    await close(o.noFee);
  });

  it('day dashboard: revenue by closing day, receivable, refunds and an exact reconciliation', async () => {
    const day = (await get(owner, '/api/reports/day').expect(200)).body;
    expect(day).toMatchObject({ date: today, isCurrent: true });
    // 5000 + 3200 + 3200 + 5500 (table) + 2000 + 2500 = 21400; refund 3200.
    expect(day.breakdown).toMatchObject({
      orders: 6,
      totalCents: 21_400,
      serviceFeeCents: 500,
      deliveryFeeCents: 1400,
      orderDiscountCents: 500,
    });
    expect(day.breakdown.netProductsCents + 500 + 1400).toBe(21_400);
    expect(day.refundsCents).toBe(3200);
    expect(day.revenueCents).toBe(18_200);
    expect(day.ticket).toEqual({
      totalCents: Math.round(21_400 / 6),
      productsCents: Math.round(19_500 / 6),
    });
    expect(day.receivable).toEqual({ orders: 1, cents: 3200 });
    // The cash screen uses the same rule: the refunded delivery is not "a receber".
    const receivables = (await get(owner, '/api/orders?receivable=true').expect(200)).body as {
      id: string;
    }[];
    const listed = receivables.map((r) => r.id);
    expect(listed).toContain(o.receivable!.id);
    expect(listed).not.toContain(o.refunded!.id);
    expect(day.canceled).toEqual({ orders: 1, totalCents: 2500 });
    expect(day.open.orders).toBe(1);
    expect(day.reconciliation).toMatchObject({
      revenueCents: 18_200,
      receivableCents: 3200,
      paidOnOtherDaysCents: 2000,
      fromPreviousDaysCents: 3200,
      forOpenOrdersCents: 1000,
      canceledNetCents: 0,
      receivedCents: 17_200,
      differenceCents: 0,
    });
    expect(day.channels).toEqual(
      expect.arrayContaining([
        { channel: 'COUNTER', orders: 2, revenueCents: 7000 },
        { channel: 'DELIVERY', orders: 2, revenueCents: 6400 },
        { channel: 'TABLE', orders: 2, revenueCents: 8000 },
      ]),
    );
    expect(day.topProducts[0]).toMatchObject({ name: 'X-Burguer', quantity: 8 });
    expect(day.attention).toMatchObject({ pendingAcceptance: 0, printersOffline: 0, soldOut: 0 });
    // Orders created today (canceled ones and yesterday's out).
    expect(day.hours.today.reduce((a: number, b: number) => a + b, 0)).toBe(6);

    // What was received matches the day's cash registers (no online payments here).
    const sessions = (await get(owner, `/api/cash-sessions?businessDate=${today}`).expect(200))
      .body as {
      totals: { methods: { receivedCents: number; refundedCents: number }[] };
    }[];
    const cash = sessions
      .flatMap((s) => s.totals.methods)
      .reduce((t, m) => t + m.receivedCents - m.refundedCents, 0);
    expect(cash).toBe(day.received.cents);

    // And the delivery report counts the same deliveries (by closing day).
    const report = (await get(owner, `/api/delivery/report?from=${today}&to=${today}`).expect(200))
      .body;
    expect(report.orders).toBe(2);
    expect(report.productsCents + report.deliveryFeesCents).toBe(6400);
    expect(report.deliveryFeesCents).toBe(day.breakdown.deliveryFeeCents);

    // Yesterday: the delivery concluded then; the table counts today (closing day).
    const prev = (await get(owner, `/api/reports/day?date=${yesterday}`).expect(200)).body;
    expect(prev).toMatchObject({ isCurrent: false, attention: null });
    expect(prev.breakdown.orders).toBe(1);
    expect(prev.receivable).toEqual({ orders: 1, cents: 3200 });
    expect(prev.reconciliation.differenceCents).toBe(0);
    expect(prev.reconciliation.forOpenOrdersCents).toBe(2000);
    expect(day.comparison).toMatchObject({ mode: 'LAST_WEEK', untilSameTime: true });
    const avg = (await get(owner, '/api/reports/day?compare=AVG_4_WEEKS').expect(200)).body;
    expect(avg.comparison.dates).toHaveLength(4);
  });

  it('period report: products with ABC, payments, channels, heatmap, waiters and CSV', async () => {
    const sales = (await get(owner, `/api/reports/sales?from=${yesterday}&to=${today}`).expect(200))
      .body;
    expect(sales.breakdown.orders).toBe(7);
    expect(sales.revenueCents).toBe(21_400 + 3200 - 3200);
    expect(sales.products[0]).toMatchObject({
      name: 'X-Burguer',
      abc: 'A',
      categoryName: 'Lanches',
    });
    expect(sales.days.map((d: { date: string }) => d.date)).toEqual([yesterday, today]);
    const cash = sales.payments.find((p: { method: string }) => p.method === 'CASH');
    expect(cash).toMatchObject({
      receivedCents: 2000 + 5000 + 3500 + 1000 + 2000 + 2500,
      refundedCents: 0,
    });
    const pix = sales.payments.find((p: { method: string }) => p.method === 'PIX');
    expect(pix).toMatchObject({ receivedCents: 3200 * 2 + 2500, refundedCents: 5700 });
    expect(sales.heatmap.orders.flat().reduce((a: number, b: number) => a + b, 0)).toBeGreaterThan(
      0,
    );
    expect(sales.waiters[0]).toMatchObject({ tables: 2 });

    const csv = await get(
      owner,
      `/api/reports/sales/csv?from=${yesterday}&to=${today}&section=products`,
    ).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.startsWith('﻿Produto;Categoria;Quantidade;Faturamento (R$)')).toBe(true);
    expect(csv.text).toContain('X-Burguer;Lanches;');
    await get(owner, `/api/reports/sales/csv?from=${yesterday}&to=${today}&section=nope`).expect(
      400,
    );
    await get(owner, `/api/reports/sales?from=${today}&to=${yesterday}`).expect(400);
    await get(owner, `/api/reports/sales?from=2020-01-01&to=${today}`).expect(400);
  });

  it('losses: cancellations, refunds, discounts and service fee removed, by user and reason', async () => {
    const losses = (await get(owner, `/api/reports/losses?from=${today}&to=${today}`).expect(200))
      .body;
    const total = (kind: string) => losses.totals.find((t: { kind: string }) => t.kind === kind);
    expect(total('ORDER_CANCELED')).toEqual({ kind: 'ORDER_CANCELED', count: 1, cents: 2500 });
    expect(total('REFUND')).toEqual({ kind: 'REFUND', count: 2, cents: 3200 + 2500 });
    expect(total('DISCOUNT')).toEqual({ kind: 'DISCOUNT', count: 1, cents: 500 });
    expect(total('SERVICE_FEE_REMOVED')).toEqual({
      kind: 'SERVICE_FEE_REMOVED',
      count: 1,
      cents: 250,
    });
    const discount = losses.events.find((e: { kind: string }) => e.kind === 'DISCOUNT');
    expect(discount).toMatchObject({ reason: 'Cliente fiel', userName: 'Dono Teste' });
    expect(losses.users[0]).toMatchObject({ name: 'Dono Teste' });
    expect(losses.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'ORDER_CANCELED', reason: 'Cliente desistiu' }),
      ]),
    );
    const csv = await get(
      owner,
      `/api/reports/losses/csv?from=${today}&to=${today}&section=events`,
    ).expect(200);
    expect(csv.text).toContain('Pedido cancelado');
  });

  it('times: preparation by sector and product from the KDS', async () => {
    const times = (await get(owner, `/api/reports/times?from=${today}&to=${today}`).expect(200))
      .body;
    expect(times.sectors[0]).toMatchObject({ name: 'Cozinha', lateAfterMinutes: 20 });
    expect(times.sectors[0].total.count).toBeGreaterThan(0);
    expect(times.products[0]).toMatchObject({ name: 'X-Burguer', sectorName: 'Cozinha' });
  });

  it('network: the owner sees each unit and the total; queries never cross tenants', async () => {
    const unit = await post(owner, '/api/stores', {
      tradeName: 'Cantina Relatórios Centro',
      legalName: 'Cantina Centro LTDA',
      cnpj: '11444777000161',
      phone: '1133334444',
    }).expect(201);
    const switched = await post(owner, '/api/auth/switch-store', { storeId: unit.body.id }).expect(
      200,
    );
    const second = bearer(switched.body.accessToken);
    await put(second, '/api/stores/current/hours', { hours: [] }).expect(200);
    const category = await post(second, '/api/menu/categories', { name: 'Bebidas' }).expect(201);
    const juice = (
      await post(second, '/api/menu/products', {
        categoryId: category.body.id,
        name: 'Suco',
        priceCents: 900,
      }).expect(201)
    ).body.id;
    await post(second, '/api/cash-sessions', { openingCents: 0 }).expect(201);
    const sold = (
      await post(second, '/api/orders', {
        type: 'TAKEOUT',
        items: [{ productId: juice, quantity: 1 }],
      }).expect(201)
    ).body as Order;
    await post(second, `/api/orders/${sold.id}/payments`, {
      expectedVersion: sold.version,
      method: 'CASH',
      amountCents: 900,
      receivedCents: 900,
    }).expect(201);
    let version = (await get(second, `/api/orders/${sold.id}`).expect(200)).body.version;
    for (const status of ['PREPARING', 'READY', 'DELIVERED']) {
      version = (
        await post(second, `/api/orders/${sold.id}/status`, {
          expectedVersion: version,
          status,
        }).expect(200)
      ).body.version;
    }

    const single = (await get(second, '/api/reports/day').expect(200)).body;
    expect(single.revenueCents).toBe(900);
    const network = (await get(owner, '/api/reports/day?scope=NETWORK').expect(200)).body;
    expect(network.scope).toBe('NETWORK');
    expect(
      network.units.map((u: { name: string; revenueCents: number }) => [u.name, u.revenueCents]),
    ).toEqual([
      ['Cantina Relatórios', 18_200],
      ['Cantina Relatórios Centro', 900],
    ]);
    expect(network.revenueCents).toBe(19_100);
    expect(network.reconciliation.differenceCents).toBe(0);
    const sales = (
      await get(owner, `/api/reports/sales?from=${today}&to=${today}&scope=NETWORK`).expect(200)
    ).body;
    expect(sales.products.map((p: { name: string }) => p.name).sort()).toEqual([
      'Suco',
      'X-Burguer',
    ]);

    // Another restaurant's owner never sees these units.
    const other = await registerStore(ctx, { tradeName: 'Outra Cantina' });
    const theirs = (
      await get(bearer(other.accessToken), '/api/reports/day?scope=NETWORK').expect(200)
    ).body;
    expect(theirs.units).toEqual([
      { storeId: other.storeId, name: 'Outra Cantina', revenueCents: 0, orders: 0, open: 0 },
    ]);
  });
});
