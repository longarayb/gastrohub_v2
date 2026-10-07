import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

type Headers = { Authorization: string };
interface Order {
  id: string;
  version: number;
  status: string;
  businessDate: string;
  [key: string]: unknown;
}

// Store at Av. Paulista; ~1.1 km north is inside the 3 km radius, ~25 km is out.
const STORE = { latitude: -23.5649, longitude: -46.6519 };

const address = (neighborhood: string, extra: object = {}) => ({
  cep: '01310100',
  street: 'Rua de Teste',
  number: '100',
  neighborhood,
  city: 'São Paulo',
  state: 'SP',
  ...extra,
});

/** Delivery areas, routes, courier app, settlement and report (D029–D031). */
describe('Delivery (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let other: RegisteredStore;
  let owner: Headers;
  let cashier: Headers;
  let waiter: Headers;
  let courierUser: Headers;
  const ids: Record<string, string> = {};

  const post = (h: Headers, url: string, body: object = {}) =>
    ctx.http().post(url).set(h).send(body);
  const put = (h: Headers, url: string, body: object = {}) => ctx.http().put(url).set(h).send(body);
  const get = (h: Headers, url: string) => ctx.http().get(url).set(h);

  async function login(email: string): Promise<Headers> {
    const res = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email, password: 'Senha1234' })
      .expect(200);
    return bearer(res.body.accessToken);
  }

  let phone = 0;
  const delivery = (neighborhood: string, extra: object = {}, h: Headers = owner) =>
    post(h, '/api/orders', {
      type: 'DELIVERY',
      customer: { name: 'Cliente', phone: `(11) 9${String(8000_0000 + ++phone)}` },
      deliveryAddress: address(neighborhood),
      items: [{ productId: ids.pizza, quantity: 1 }],
      ...extra,
    });

  async function ready(o: Order): Promise<Order> {
    let current = o;
    for (const status of ['PREPARING', 'READY']) {
      current = (
        await post(owner, `/api/orders/${o.id}/status`, {
          expectedVersion: current.version,
          status,
        }).expect(200)
      ).body;
    }
    return current;
  }

  const fetchOrder = async (id: string): Promise<Order> =>
    (await get(owner, `/api/orders/${id}`).expect(200)).body;

  const audits = (action: string) =>
    ctx.prisma.auditLog.count({ where: { tenantId: store.storeId, action } });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Entregas Teste' });
    other = await registerStore(ctx, { tradeName: 'Sem Áreas' });
    owner = bearer(store.accessToken);
    await ctx.prisma.store.update({ where: { id: store.storeId }, data: STORE });

    for (const [email, role] of [
      ['caixa.entregas@teste.com', 'CASHIER'],
      ['garcom.entregas@teste.com', 'WAITER'],
      ['moto.entregas@teste.com', 'COURIER'],
    ] as const) {
      const user = await post(owner, '/api/users', {
        name: role,
        email,
        role,
        password: 'Senha1234',
      }).expect(201);
      ids[role] = user.body.id;
    }
    cashier = await login('caixa.entregas@teste.com');
    waiter = await login('garcom.entregas@teste.com');
    courierUser = await login('moto.entregas@teste.com');

    const category = await post(owner, '/api/menu/categories', { name: 'Pizzas' }).expect(201);
    ids.pizza = (
      await post(owner, '/api/menu/products', {
        categoryId: category.body.id,
        name: 'Pizza',
        priceCents: 4000,
      }).expect(201)
    ).body.id;
    ids.motoA = (await post(owner, '/api/couriers', { name: 'Moto A' }).expect(201)).body.id;
    ids.motoB = (await post(owner, '/api/couriers', { name: 'Moto B' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('areas: neighborhood with variations, radius, pause and permissions', async () => {
    const centro = {
      name: 'Centro',
      neighborhoods: ['Centro', 'Centro Histórico'],
      feeCents: 500,
      etaMinutes: 30,
      minimumOrderCents: 3000,
      freeAboveCents: 10_000,
    };
    await post(cashier, '/api/delivery/areas', centro).expect(403);
    ids.centro = (await post(owner, '/api/delivery/areas', centro).expect(201)).body.id;

    const clash = await post(owner, '/api/delivery/areas', {
      ...centro,
      name: 'Outra',
      neighborhoods: ['centro historico'],
    }).expect(400);
    expect(clash.body.message).toBe('O bairro "centro historico" já está na área Centro');

    ids.raio = (
      await post(owner, '/api/delivery/areas', {
        name: 'Até 3 km',
        kind: 'RADIUS',
        radiusMeters: 3000,
        feeCents: 900,
        etaMinutes: 45,
      }).expect(201)
    ).body.id;

    const quote = (neighborhood: string, subtotalCents: number, extra: object = {}) =>
      post(cashier, '/api/delivery/quote', {
        address: address(neighborhood, extra),
        subtotalCents,
      }).expect(200);

    // Accents and case do not matter; free above 100,00.
    const byName = (await quote('CENTRO HISTORICO', 4000)).body;
    expect(byName.area).toMatchObject({ id: ids.centro, matchedBy: 'NEIGHBORHOOD' });
    expect(byName.quote).toMatchObject({ feeCents: 500, etaMinutes: 30, belowMinimum: false });
    expect((await quote('Centro', 12_000)).body.quote).toMatchObject({
      feeCents: 0,
      freeDelivery: true,
    });
    expect((await quote('Centro', 2000)).body.quote.belowMinimum).toBe(true);

    // Radius needs coordinates (the test geocoder finds nothing).
    const noCoords = (await quote('Jardins', 4000)).body;
    expect(noCoords).toMatchObject({ area: null, reason: 'NEEDS_COORDINATES' });
    expect(noCoords.areas).toHaveLength(2);
    const near = (await quote('Jardins', 4000, { latitude: -23.555, longitude: -46.6519 })).body;
    expect(near.area).toMatchObject({ id: ids.raio, matchedBy: 'RADIUS' });
    expect(near.distanceMeters).toBeGreaterThan(1000);
    const far = (await quote('Longe', 4000, { latitude: -23.8, longitude: -46.65 })).body;
    expect(far).toMatchObject({ area: null, reason: 'OUT_OF_AREA' });

    // Temporary pause (operational: the cashier can do it).
    await post(cashier, `/api/delivery/areas/${ids.centro}/pause`, { reason: 'Chuva' }).expect(200);
    const paused = (await quote('Centro', 4000)).body;
    expect(paused).toMatchObject({ reason: 'PAUSED', area: null });
    expect(paused.message).toBe('Entrega temporariamente indisponível para Centro (Chuva)');
    await post(cashier, `/api/delivery/areas/${ids.centro}/resume`).expect(200);
    expect((await quote('Centro', 4000)).body.area.id).toBe(ids.centro);
    expect(await audits('delivery.area_paused')).toBe(1);
    expect(await audits('delivery.area_resumed')).toBe(1);
  });

  it('orders: area fee by default; reducing needs permission and reason; changes audited', async () => {
    const auto = (await delivery('centro').expect(201)).body;
    expect(auto).toMatchObject({ deliveryFeeCents: 500, totalCents: 4500 });
    expect(auto.delivery).toMatchObject({
      areaId: ids.centro,
      areaName: 'Centro',
      areaSource: 'AUTO',
      etaMinutes: 30,
      suggestedFeeCents: 500,
      attempts: 0,
    });
    expect(auto.delivery.links.google).toMatch(/^https:\/\/www\.google\.com\/maps\/search/);
    expect(auto.delivery.links.waze).toMatch(/^https:\/\/waze\.com\/ul\?q=/);

    // Unknown neighborhood and no coordinates (radius area): the operator picks the area.
    const unknown = await delivery('Vila Nova').expect(400);
    const message = 'Não foi possível localizar o endereço no mapa: escolha a área manualmente';
    expect(unknown.body.message).toBe(message);
    expect(unknown.body.details).toEqual([{ path: 'deliveryAreaId', message }]);
    // With coordinates beyond every radius: out of area.
    const out = await delivery('Longe', {
      deliveryAddress: address('Longe', { latitude: -23.8, longitude: -46.65 }),
    }).expect(400);
    expect(out.body.message).toBe('Endereço fora da área de entrega');
    const manual = (await delivery('Vila Nova', { deliveryAreaId: ids.centro }).expect(201)).body;
    expect(manual.delivery).toMatchObject({ areaSource: 'MANUAL', areaName: 'Centro' });

    // Reducing: permission (orders:discount) and a reason.
    await delivery('Centro', { deliveryFeeCents: 0 }, waiter).expect(403);
    const noReason = await delivery('Centro', { deliveryFeeCents: 0 }, cashier).expect(400);
    expect(noReason.body.message).toBe('Informe o motivo para reduzir a taxa de entrega');
    const reduced = (
      await delivery(
        'Centro',
        { deliveryFeeCents: 200, deliveryFeeReason: 'Cliente frequente' },
        cashier,
      ).expect(201)
    ).body;
    expect(reduced).toMatchObject({ deliveryFeeCents: 200, totalCents: 4200 });
    expect(reduced.delivery.feeChangeReason).toBe('Cliente frequente');

    // Increasing needs no permission but is audited too.
    const increased = (await delivery('Centro', { deliveryFeeCents: 800 }, waiter).expect(201))
      .body;
    expect(increased.deliveryFeeCents).toBe(800);
    expect(await audits('delivery.fee_changed')).toBe(2);

    // A store without areas: the fee is typed by hand.
    const otherOwner = bearer(other.accessToken);
    const otherCategory = await post(otherOwner, '/api/menu/categories', { name: 'Lanches' });
    const otherProduct = await post(otherOwner, '/api/menu/products', {
      categoryId: otherCategory.body.id,
      name: 'Lanche',
      priceCents: 3000,
    }).expect(201);
    const plain = (
      await delivery(
        'Qualquer',
        { deliveryFeeCents: 700, items: [{ productId: otherProduct.body.id, quantity: 1 }] },
        otherOwner,
      ).expect(201)
    ).body;
    expect(plain).toMatchObject({ deliveryFeeCents: 700 });
    expect(plain.delivery.areaSource).toBe('NONE');
  });

  it('areas: unmatched neighborhoods can be added to an area', async () => {
    const before = (await get(owner, '/api/delivery/areas/unmatched').expect(200)).body;
    expect(before).toEqual([
      expect.objectContaining({ neighborhood: 'Vila Nova', city: 'São Paulo' }),
    ]);
    await get(cashier, '/api/delivery/areas/unmatched').expect(403);
    const updated = await post(owner, `/api/delivery/areas/${ids.centro}/neighborhoods`, {
      name: 'Vila Nova',
    }).expect(200);
    expect(updated.body.neighborhoods).toEqual(['Centro', 'Centro Histórico', 'Vila Nova']);
    expect((await get(owner, '/api/delivery/areas/unmatched').expect(200)).body).toEqual([]);
  });

  it('route: several orders, courier app (own deliveries only), not delivered and re-dispatch', async () => {
    // Link the courier user to "Moto A".
    await put(owner, `/api/delivery/couriers/${ids.motoA}`, {
      name: 'Moto A',
      isActive: true,
      userId: ids.WAITER,
    }).expect(400);
    await put(owner, `/api/delivery/couriers/${ids.motoA}`, {
      name: 'Moto A',
      isActive: true,
      userId: ids.COURIER,
    }).expect(200);

    let o1 = (
      await delivery('Centro', { expectedPaymentMethod: 'CASH', changeForCents: 5000 }).expect(201)
    ).body as Order;
    let o2 = (await delivery('Centro', { expectedPaymentMethod: 'PIX' }).expect(201)).body as Order;
    const o3 = (await delivery('Centro').expect(201)).body as Order;
    o1 = await ready(o1);
    o2 = await ready(o2);

    // The courier has no access to the board or the orders (LGPD).
    await get(courierUser, '/api/orders').expect(403);
    expect((await get(courierUser, '/api/courier/me').expect(200)).body).toMatchObject({
      courier: { name: 'Moto A' },
      run: null,
    });
    await get(owner, '/api/courier/me').expect(403);

    const notReady = await post(owner, '/api/orders/dispatch', {
      courierId: ids.motoA,
      orders: [
        { orderId: o1.id, expectedVersion: o1.version },
        { orderId: o3.id, expectedVersion: o3.version },
      ],
    }).expect(400);
    expect(notReady.body.message).toMatch(/ainda não está pronto/);

    const dispatched = (
      await post(cashier, '/api/orders/dispatch', {
        courierId: ids.motoA,
        orders: [
          { orderId: o1.id, expectedVersion: o1.version },
          { orderId: o2.id, expectedVersion: o2.version },
        ],
      }).expect(200)
    ).body as Order[];
    expect(dispatched.map((o) => [o.status, o.courierName])).toEqual([
      ['DISPATCHED', 'Moto A'],
      ['DISPATCHED', 'Moto A'],
    ]);
    const couriers = (await get(cashier, '/api/delivery/couriers').expect(200)).body;
    expect(couriers.find((c: { id: string }) => c.id === ids.motoA)).toMatchObject({
      status: 'ON_ROUTE',
      userName: 'COURIER',
      openRun: { stops: 2, delivered: 0 },
    });

    const me = (await get(courierUser, '/api/courier/me').expect(200)).body;
    expect(me.run.stops).toHaveLength(2);
    expect(me.run.stops[0]).toMatchObject({
      status: 'PENDING',
      chargeCents: 4500,
      expectedPaymentMethod: 'CASH',
      changeForCents: 5000,
    });
    expect(me.run.stops[0].links.google).toMatch(/google\.com\/maps/);
    const [stop1, stop2] = me.run.stops.map((s: { stopId: string }) => s.stopId);

    // Delivered: how the customer paid is required when there is a balance.
    const noPayment = await post(courierUser, `/api/courier/stops/${stop1}/deliver`).expect(400);
    expect(noPayment.body.message).toBe('Informe como o cliente pagou');
    await post(courierUser, `/api/courier/stops/${stop1}/deliver`, {
      collection: { method: 'CASH', amountCents: 4500, receivedCents: 5000 },
    }).expect(200);
    expect((await fetchOrder(o1.id)).status).toBe('DELIVERED');

    // Not delivered: the order goes back to the store with the reason visible.
    const failed = (
      await post(courierUser, `/api/courier/stops/${stop2}/fail`, {
        reason: 'CUSTOMER_ABSENT',
      }).expect(200)
    ).body;
    expect(failed.run.stops[1]).toMatchObject({
      status: 'FAILED',
      failureReason: 'CUSTOMER_ABSENT',
    });
    const back = await fetchOrder(o2.id);
    expect(back).toMatchObject({
      status: 'READY',
      courierName: null,
      deliveryFailure: { reason: 'CUSTOMER_ABSENT' },
    });
    expect((back.history as { reason: string }[]).at(-1)!.reason).toBe(
      'Entrega não realizada: Cliente ausente',
    );
    expect(await audits('delivery.failed')).toBe(1);
    const board = (await get(owner, '/api/orders?board=true').expect(200)).body;
    expect(board.find((o: { id: string }) => o.id === o2.id).deliveryFailure.reason).toBe(
      'CUSTOMER_ABSENT',
    );

    // Re-dispatch in the same route (the courier is still out).
    const again = (
      await post(owner, '/api/orders/dispatch', {
        courierId: ids.motoA,
        orders: [{ orderId: o2.id, expectedVersion: back.version }],
      }).expect(200)
    ).body[0];
    expect(again.deliveryFailure).toBeNull();
    expect(again.delivery).toMatchObject({ attempts: 2 });
    expect(again.delivery.stops).toHaveLength(2);
    const route = (await get(courierUser, '/api/courier/me').expect(200)).body.run;
    expect(route.stops).toHaveLength(3);
    const stop3 = route.stops[2].stopId;

    // Cannot return while a delivery is open.
    const open = await post(courierUser, '/api/courier/return').expect(400);
    expect(open.body.message).toBe(
      'Ainda há 1 entrega em aberto: marque como entregue ou não entregue',
    );
    await post(courierUser, `/api/courier/stops/${stop3}/deliver`, {
      collection: { method: 'PIX', amountCents: 4500 },
    }).expect(200);
    expect((await post(courierUser, '/api/courier/return').expect(200)).body.run).toBeNull();
    ids.o1 = o1.id;
    ids.o2 = o2.id;

    // Courier without the app (Moto B): the board assigns, dispatches and closes.
    let o3r = await ready(o3);
    o3r = (
      await post(owner, `/api/orders/${o3.id}/courier`, {
        expectedVersion: o3r.version,
        courierId: ids.motoB,
      }).expect(200)
    ).body;
    o3r = (
      await post(owner, `/api/orders/${o3.id}/status`, {
        expectedVersion: o3r.version,
        status: 'DISPATCHED',
      }).expect(200)
    ).body;
    // The courier user only sees their own route.
    const otherStop = (o3r.delivery as { stops: { id: string }[] }).stops[0]!.id;
    await post(courierUser, `/api/courier/stops/${otherStop}/deliver`).expect(404);
    await post(owner, `/api/orders/${o3.id}/status`, {
      expectedVersion: o3r.version,
      status: 'DELIVERED',
    }).expect(200);
    const runB = (await get(owner, '/api/delivery/couriers').expect(200)).body.find(
      (c: { id: string }) => c.id === ids.motoB,
    ).openRun;
    await post(cashier, `/api/delivery/runs/${runB.id}/return`).expect(204);
  });

  it('settlement: payments into the settling register, shortage, pay now and balance', async () => {
    await put(owner, '/api/delivery/settings', {
      perDeliveryCents: 300,
      feeShareBps: 5000,
      dailyCents: 2000,
    }).expect(200);

    const preview = (
      await get(cashier, `/api/delivery/settlements/preview?courierId=${ids.motoA}`).expect(200)
    ).body;
    expect(preview.runs).toEqual([expect.objectContaining({ stops: 3, pending: 0 })]);
    expect(
      preview.stops.map((s: { status: string; method: string; balanceCents: number }) => [
        s.status,
        s.method,
        s.balanceCents,
      ]),
    ).toEqual([
      ['DELIVERED', 'CASH', 4500],
      ['FAILED', 'PIX', 0],
      ['DELIVERED', 'PIX', 4500],
    ]);
    // 2 deliveries × 3,00 + 50% of 10,00 in fees + daily 20,00.
    expect(preview.earnings).toEqual({
      perDeliveryCents: 600,
      feeShareCents: 500,
      dailyCents: 2000,
      totalCents: 3100,
    });
    expect(preview).toMatchObject({ includesDaily: true, previousBalanceCents: 0 });

    const body = {
      courierId: ids.motoA,
      runIds: preview.runs.map((r: { id: string }) => r.id),
      stops: [],
      countedCashCents: 4300, // 2,00 missing
      countedCardCents: 0,
      payNowCents: 1000,
      deductShortage: true,
    };
    const noRegister = await post(cashier, '/api/delivery/settlements', body).expect(400);
    expect(noRegister.body.message).toBe('Abra o caixa para fazer o acerto');
    const session = (
      await post(cashier, '/api/cash-sessions', { openingCents: 10_000 }).expect(201)
    ).body;

    const tooMuch = await post(cashier, '/api/delivery/settlements', {
      ...body,
      payNowCents: 5000,
    }).expect(400);
    expect(tooMuch.body.message).toBe('Pagamento maior que o saldo do entregador (R$ 29,00)');

    const settled = (await post(cashier, '/api/delivery/settlements', body).expect(201)).body;
    expect(settled).toMatchObject({
      courierName: 'Moto A',
      deliveries: 2,
      failedDeliveries: 1,
      deliveryFeesCents: 1000,
      expectedCashCents: 4500,
      cashDifferenceCents: -200,
      otherCents: 4500,
      earningsCents: 3100,
      previousBalanceCents: 0,
      shortageDeductedCents: 200,
      payoutCents: 1000,
      newBalanceCents: 1900,
      courierOwesCents: 0,
    });

    // The orders are paid into the settler's register; the drawer is corrected.
    for (const id of [ids.o1, ids.o2]) {
      expect(await fetchOrder(id!)).toMatchObject({ paymentStatus: 'PAID', balanceCents: 0 });
    }
    const payments = await ctx.prisma.payment.findMany({
      where: { orderId: { in: [ids.o1!, ids.o2!] } },
      orderBy: { method: 'asc' },
    });
    expect(
      payments.map((p) => [p.method, p.cashSessionId, p.receivedCents, p.changeCents]),
    ).toEqual([
      ['CASH', session.id, 5000, 500],
      ['PIX', session.id, null, null],
    ]);
    const movements = await ctx.prisma.cashMovement.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(movements.map((m) => [m.type, m.amountCents, m.reason])).toEqual([
      ['WITHDRAWAL', 200, 'Falta no acerto do entregador Moto A'],
      ['WITHDRAWAL', 1000, 'Pagamento ao entregador Moto A · Acerto'],
    ]);
    const ledger = (await get(cashier, `/api/delivery/couriers/${ids.motoA}/ledger`).expect(200))
      .body;
    expect(
      ledger.map((e: { type: string; amountCents: number }) => [e.type, e.amountCents]),
    ).toEqual([
      ['PAYOUT', -1000],
      ['SHORTAGE', -200],
      ['EARNING', 3100],
    ]);
    expect(ledger[0].balanceAfterCents).toBe(1900);
    expect(await audits('courier.settled')).toBe(1);

    // Already settled.
    const twice = await post(cashier, '/api/delivery/settlements', body).expect(400);
    expect(twice.body.message).toMatch(/já foi acertada/);
    expect(
      (await get(cashier, `/api/delivery/settlements/preview?courierId=${ids.motoA}`).expect(200))
        .body.runs,
    ).toEqual([]);

    // A second route on the same business day: no daily again.
    const o4 = await ready((await delivery('Centro').expect(201)).body as Order);
    await post(owner, '/api/orders/dispatch', {
      courierId: ids.motoA,
      orders: [{ orderId: o4.id, expectedVersion: o4.version }],
    }).expect(200);
    const me = (await get(courierUser, '/api/courier/me').expect(200)).body;
    await post(courierUser, `/api/courier/stops/${me.run.stops[0].stopId}/deliver`, {
      collection: { method: 'DEBIT_CARD', amountCents: 4500 },
    }).expect(200);
    await post(courierUser, '/api/courier/return').expect(200);
    const second = (
      await get(cashier, `/api/delivery/settlements/preview?courierId=${ids.motoA}`).expect(200)
    ).body;
    expect(second).toMatchObject({ includesDaily: false, previousBalanceCents: 1900 });
    expect(second.earnings.totalCents).toBe(300 + 250);
    expect(second.stops[0]).toMatchObject({ method: 'DEBIT_CARD', declared: true });
  });

  it('payout from the balance (withdrawal) and the report', async () => {
    const tooMuch = await post(cashier, `/api/delivery/couriers/${ids.motoA}/payouts`, {
      amountCents: 5000,
    }).expect(400);
    expect(tooMuch.body.message).toBe('Pagamento maior que o saldo do entregador (R$ 19,00)');
    await post(waiter, `/api/delivery/couriers/${ids.motoA}/payouts`, {
      amountCents: 500,
    }).expect(403);
    const ledger = (
      await post(cashier, `/api/delivery/couriers/${ids.motoA}/payouts`, {
        amountCents: 900,
        reason: 'Semanal',
      }).expect(200)
    ).body;
    expect(ledger[0]).toMatchObject({
      type: 'PAYOUT',
      amountCents: -900,
      reason: 'Semanal',
      balanceAfterCents: 1000,
    });
    expect(await audits('courier.payout')).toBe(2);

    const day = (await fetchOrder(ids.o1!)).businessDate;
    const report = (await get(owner, `/api/delivery/report?from=${day}&to=${day}`).expect(200))
      .body;
    expect(report).toMatchObject({ orders: 4, deliveryFeesCents: 2000, productsCents: 16_000 });
    expect(report.byCourier.find((r: { name: string }) => r.name === 'Moto A')).toMatchObject({
      deliveries: 3,
      failures: 1,
    });
    expect(report.byArea).toEqual([expect.objectContaining({ name: 'Centro', deliveries: 4 })]);
    expect(report.balances).toEqual([
      expect.objectContaining({ name: 'Moto A', balanceCents: 1000, courierOwesCents: 0 }),
    ]);
    await get(cashier, `/api/delivery/report?from=${day}&to=${day}`).expect(403);
  });
});
