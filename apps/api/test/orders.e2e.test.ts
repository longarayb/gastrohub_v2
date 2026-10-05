import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

type Headers = { Authorization: string };

describe('Orders (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let other: RegisteredStore;
  let owner: Headers;
  let waiter: Headers;
  let cashier: Headers;
  const ids: Record<string, string> = {};

  const post = (h: Headers, url: string, body: object = {}) =>
    ctx.http().post(url).set(h).send(body);
  const get = (h: Headers, url: string) => ctx.http().get(url).set(h);

  async function login(email: string): Promise<Headers> {
    const res = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email, password: 'Senha1234' })
      .expect(200);
    return bearer(res.body.accessToken);
  }

  const burger = (extra: object = {}) => ({
    productId: ids.burger,
    quantity: 1,
    modifiers: [{ groupId: ids.ponto, optionId: ids.aoPonto, quantity: 1 }],
    ...extra,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Pedidos Teste' });
    other = await registerStore(ctx, { tradeName: 'Outra Unidade' });
    owner = bearer(store.accessToken);

    for (const [email, role] of [
      ['garcom.pedidos@teste.com', 'WAITER'],
      ['caixa.pedidos@teste.com', 'CASHIER'],
    ] as const) {
      await post(owner, '/api/users', { name: role, email, role, password: 'Senha1234' }).expect(
        201,
      );
    }
    waiter = await login('garcom.pedidos@teste.com');
    cashier = await login('caixa.pedidos@teste.com');

    // Menu: kitchen sector, burger with required "ponto", drink, pizza with crust by size
    ids.kitchen = (await post(owner, '/api/menu/sectors', { name: 'Cozinha' }).expect(201)).body.id;
    const ponto = await post(owner, '/api/menu/modifier-groups', {
      name: 'Ponto',
      options: [{ name: 'Ao ponto' }, { name: 'Bem passado' }],
    }).expect(201);
    ids.ponto = ponto.body.id;
    ids.aoPonto = ponto.body.options[0].id;
    const extras = await post(owner, '/api/menu/modifier-groups', {
      name: 'Adicionais',
      options: [{ name: 'Bacon', priceCents: 500, maxQuantity: 2 }],
    }).expect(201);
    ids.extras = extras.body.id;
    ids.bacon = extras.body.options[0].id;
    const lanches = await post(owner, '/api/menu/categories', {
      name: 'Lanches',
      modifierLinks: [{ groupId: ids.extras, minSelect: 0, maxSelect: 2 }],
    }).expect(201);
    ids.burger = (
      await post(owner, '/api/menu/products', {
        categoryId: lanches.body.id,
        name: 'X-Burguer',
        priceCents: 3000,
        promoPriceCents: 2500,
        modifierLinks: [{ groupId: ids.ponto, minSelect: 1, maxSelect: 1 }],
      }).expect(201)
    ).body.id;
    ids.paused = (
      await post(owner, '/api/menu/products', {
        categoryId: lanches.body.id,
        name: 'Esgotado',
        priceCents: 1000,
      }).expect(201)
    ).body.id;
    await post(owner, `/api/menu/products/${ids.paused}/pause`, { mode: 'INDEFINITE' }).expect(200);
    ids.water = (
      await post(owner, '/api/menu/products', {
        categoryId: lanches.body.id,
        name: 'Água',
        priceCents: 500,
        modifierLinks: [{ groupId: ids.extras, isDisabled: true }],
      }).expect(201)
    ).body.id;

    const pizzas = await post(owner, '/api/menu/categories', {
      name: 'Pizzas',
      kind: 'PIZZA',
    }).expect(201);
    ids.pizzas = pizzas.body.id;
    const sizes = await ctx
      .http()
      .put(`/api/menu/categories/${ids.pizzas}/sizes`)
      .set(owner)
      .send({ sizes: [{ name: 'Média', maxFlavors: 2 }] })
      .expect(200);
    ids.media = sizes.body.sizes[0].id;
    for (const [name, price] of [
      ['Calabresa', 5000],
      ['Camarão', 7000],
    ] as const) {
      ids[name] = (
        await post(owner, '/api/menu/products', {
          categoryId: ids.pizzas,
          name,
          flavorPrices: [{ sizeId: ids.media, priceCents: price }],
        }).expect(201)
      ).body.id;
    }

    ids.table1 = (await post(owner, '/api/tables', { name: '1' }).expect(201)).body[0].id;
    await post(owner, '/api/coupons', {
      code: 'dez',
      type: 'PERCENT',
      value: 1000,
      minOrderCents: 2000,
    }).expect(201);
    await post(owner, '/api/coupons', {
      code: 'UNICO',
      type: 'FIXED',
      value: 500,
      usageLimit: 1,
    }).expect(201);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('creates a takeout order priced by the server (client prices are ignored)', async () => {
    const res = await post(owner, '/api/orders', {
      type: 'TAKEOUT',
      items: [
        burger({
          quantity: 2,
          unitChargedPriceCents: 1, // ignored
          modifiers: [
            { groupId: ids.ponto, optionId: ids.aoPonto, quantity: 1 },
            { groupId: ids.extras, optionId: ids.bacon, quantity: 1 },
          ],
        }),
      ],
      totalCents: 1, // ignored
    }).expect(201);

    expect(res.body).toMatchObject({
      type: 'TAKEOUT',
      source: 'POS',
      status: 'ACCEPTED',
      version: 0,
      subtotalCents: (2500 + 500) * 2,
      serviceFeeCents: 0, // only dine-in by default
      promoSavingsCents: 1000,
      totalCents: 6000,
    });
    expect(res.body.number).toBeGreaterThan(0);
    expect(res.body.publicCode).toMatch(/^[0-9A-Z]{8}$/);
    expect(res.body.items[0]).toMatchObject({
      status: 'QUEUED',
      sectorId: ids.kitchen, // default sector
      unitFullPriceCents: 3500,
      unitChargedPriceCents: 3000,
    });
    expect(res.body.items[0].snapshot.modifiers.map((m: { name: string }) => m.name)).toEqual([
      'Ao ponto',
      'Bacon',
    ]);
    expect(res.body.history).toEqual([
      expect.objectContaining({ fromStatus: null, toStatus: 'ACCEPTED', userName: 'Dono Teste' }),
    ]);
  });

  it('numbers concurrent orders sequentially without repeating', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        post(owner, '/api/orders', { type: 'TAKEOUT', items: [burger()] }),
      ),
    );
    for (const r of results) expect(r.status).toBe(201);
    const numbers = results.map((r) => r.body.number as number).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(8);
    expect(numbers.at(-1)! - numbers[0]!).toBe(7);
  });

  it('is idempotent with Idempotency-Key, including concurrent duplicates', async () => {
    const key = randomUUID();
    const body = { type: 'TAKEOUT', items: [burger()] };
    const [a, b] = await Promise.all([
      post(owner, '/api/orders', body).set('Idempotency-Key', key),
      post(owner, '/api/orders', body).set('Idempotency-Key', key),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.id).toBe(b.body.id);
    const again = await post(owner, '/api/orders', body).set('Idempotency-Key', key).expect(201);
    expect(again.body.id).toBe(a.body.id);
    await post(owner, '/api/orders', { ...body, notes: 'diferente' })
      .set('Idempotency-Key', key)
      .expect(409);
  });

  it('rejects unavailable items and invalid complements with pt-BR reasons', async () => {
    const paused = await post(owner, '/api/orders', {
      type: 'TAKEOUT',
      items: [{ productId: ids.paused, quantity: 1 }],
    }).expect(422);
    expect(paused.body.message).toBe('Esgotado: Produto pausado');

    const noPonto = await post(owner, '/api/orders', {
      type: 'TAKEOUT',
      items: [{ productId: ids.burger, quantity: 1 }],
    }).expect(422);
    expect(noPonto.body.message).toBe('X-Burguer: Escolha uma opção em "Ponto"');

    const tooMany = await post(owner, '/api/orders', {
      type: 'TAKEOUT',
      items: [
        {
          pizza: {
            categoryId: ids.pizzas,
            sizeId: ids.media,
            flavors: [
              { productId: ids.Calabresa },
              { productId: ids['Camarão'] },
              { productId: ids.burger },
            ],
          },
          quantity: 1,
        },
      ],
    }).expect(422);
    expect(tooMany.body.message).toMatch(/sabor não encontrado|permite até 2 sabores/);
  });

  it('prices half-and-half pizzas with the store rule', async () => {
    const res = await post(owner, '/api/orders', {
      type: 'TAKEOUT',
      items: [
        {
          pizza: {
            categoryId: ids.pizzas,
            sizeId: ids.media,
            flavors: [
              { productId: ids.Calabresa },
              { productId: ids['Camarão'], note: 'sem cebola' },
            ],
          },
          quantity: 1,
        },
      ],
    }).expect(201);
    expect(res.body.totalCents).toBe(7000); // highest flavor
    expect(res.body.items[0].snapshot.flavors[1]).toMatchObject({
      name: 'Camarão',
      note: 'sem cebola',
    });
  });

  it('delivery copies customer and address; later customer changes do not alter the order', async () => {
    const address = {
      cep: '01310100',
      street: 'Avenida Paulista',
      number: '1000',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
    };
    const res = await post(owner, '/api/orders', {
      type: 'DELIVERY',
      customer: { name: 'Maria Cliente', phone: '(11) 98888-7777' },
      deliveryAddress: address,
      deliveryFeeCents: 700,
      items: [burger()],
      expectedPaymentMethod: 'CASH',
      changeForCents: 5000,
    }).expect(201);
    expect(res.body).toMatchObject({
      customerName: 'Maria Cliente',
      customerPhone: '11988887777',
      deliveryFeeCents: 700,
      serviceFeeCents: 0,
      totalCents: 2500 + 700,
      neighborhood: 'Bela Vista',
      status: 'ACCEPTED',
    });
    ids.delivery = res.body.id;
    ids.customer = res.body.customerId;

    const found = await get(cashier, '/api/customers?q=98888').expect(200);
    expect(found.body[0]).toMatchObject({ name: 'Maria Cliente', orderCount: 1 });
    expect(found.body[0].addresses).toHaveLength(1);

    await ctx.prisma.customer.update({ where: { id: ids.customer }, data: { name: 'Outro Nome' } });
    const order = await get(owner, `/api/orders/${ids.delivery}`).expect(200);
    expect(order.body.customerName).toBe('Maria Cliente');
  });

  it('follows the status flow with history, rejects invalid transitions and stale versions', async () => {
    const order = (await get(owner, `/api/orders/${ids.delivery}`)).body;
    const invalid = await post(owner, `/api/orders/${ids.delivery}/status`, {
      expectedVersion: order.version,
      status: 'DELIVERED',
    }).expect(400);
    expect(invalid.body.message).toBe('Não é possível mudar de "Aceito" para "Concluído"');

    const preparing = await post(cashier, `/api/orders/${ids.delivery}/status`, {
      expectedVersion: order.version,
      status: 'PREPARING',
    }).expect(200);
    expect(preparing.body.version).toBe(order.version + 1);

    // Another screen still has the old version.
    const stale = await post(owner, `/api/orders/${ids.delivery}/status`, {
      expectedVersion: order.version,
      status: 'PREPARING',
    }).expect(409);
    expect(stale.body.message).toMatch(/alterado por outra pessoa/);

    let version = preparing.body.version;
    for (const status of ['READY', 'DISPATCHED', 'DELIVERED']) {
      const res = await post(cashier, `/api/orders/${ids.delivery}/status`, {
        expectedVersion: version,
        status,
      }).expect(200);
      version = res.body.version;
    }
    const final = await get(owner, `/api/orders/${ids.delivery}`).expect(200);
    expect(final.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
      'ACCEPTED',
      'PREPARING',
      'READY',
      'DISPATCHED',
      'DELIVERED',
    ]);
    expect(final.body.items[0].status).toBe('SERVED');
  });

  it('cancellation requires permission and reason, and is audited', async () => {
    const order = (
      await post(owner, '/api/orders', { type: 'TAKEOUT', items: [burger()] }).expect(201)
    ).body;
    await post(waiter, `/api/orders/${order.id}/status`, {
      expectedVersion: order.version,
      status: 'CANCELED',
      reason: 'Cliente desistiu',
    }).expect(403);
    await post(cashier, `/api/orders/${order.id}/status`, {
      expectedVersion: order.version,
      status: 'CANCELED',
    }).expect(400);
    const canceled = await post(cashier, `/api/orders/${order.id}/status`, {
      expectedVersion: order.version,
      status: 'CANCELED',
      reason: 'Cliente desistiu',
    }).expect(200);
    expect(canceled.body).toMatchObject({ status: 'CANCELED', cancelReason: 'Cliente desistiu' });
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { tenantId: store.storeId, action: 'order.canceled', entityId: order.id },
    });
    expect(audit?.reason).toBe('Cliente desistiu');
  });

  it('table session: several tabs, rounds, service fee, item cancel and closing', async () => {
    const tab1 = await post(waiter, '/api/orders', {
      type: 'DINE_IN',
      tableId: ids.table1,
      tabLabel: 'Ana',
      items: [burger()],
    }).expect(201);
    expect(tab1.body).toMatchObject({
      status: 'ACCEPTED',
      tableNames: ['1'],
      serviceFeeBps: 1000,
      serviceFeeCents: 250,
      totalCents: 2750,
    });

    // A second tab on the same (occupied) table joins the same session.
    const tab2 = await post(waiter, '/api/orders', {
      type: 'DINE_IN',
      tableId: ids.table1,
      tabLabel: 'Bruno',
      items: [burger()],
    }).expect(201);
    expect(tab2.body.tableSessionId).toBe(tab1.body.tableSessionId);
    const tables = await get(waiter, '/api/tables').expect(200);
    expect(tables.body[0].session.tabs.map((t: { tabLabel: string }) => t.tabLabel)).toEqual([
      'Ana',
      'Bruno',
    ]);

    // Round 2 kept as draft, then sent; a ready tab goes back to preparing.
    let tab = (
      await post(cashier, `/api/orders/${tab1.body.id}/status`, {
        expectedVersion: 0,
        status: 'PREPARING',
      }).expect(200)
    ).body;
    tab = (
      await post(cashier, `/api/orders/${tab.id}/status`, {
        expectedVersion: tab.version,
        status: 'READY',
      }).expect(200)
    ).body;
    tab = (
      await post(waiter, `/api/orders/${tab.id}/items`, {
        expectedVersion: tab.version,
        items: [burger({ quantity: 2 })],
        send: false,
      }).expect(201)
    ).body;
    expect(tab.draftItemCount).toBe(1);
    expect(tab.rounds).toHaveLength(2);
    await post(cashier, `/api/orders/${tab.id}/status`, {
      expectedVersion: tab.version,
      status: 'DELIVERED',
    }).expect(400);
    tab = (
      await post(waiter, `/api/orders/${tab.id}/send`, { expectedVersion: tab.version }).expect(200)
    ).body;
    expect(tab.status).toBe('PREPARING');
    expect(tab.items.every((i: { status: string }) => i.status !== 'DRAFT')).toBe(true);
    expect(tab.totalCents).toBe(Math.round(7500 * 1.1));

    // Cancel a sent item: waiter forbidden, cashier with reason → audited and totals recomputed.
    const sentItem = tab.items[1];
    await post(waiter, `/api/orders/${tab.id}/items/${sentItem.id}/cancel`, {
      expectedVersion: tab.version,
      reason: 'Errado',
    }).expect(403);
    tab = (
      await post(cashier, `/api/orders/${tab.id}/items/${sentItem.id}/cancel`, {
        expectedVersion: tab.version,
        reason: 'Pedido errado',
      }).expect(200)
    ).body;
    expect(tab.subtotalCents).toBe(2500);
    const itemAudit = await ctx.prisma.auditLog.findFirst({
      where: { tenantId: store.storeId, action: 'order.item_canceled', entityId: tab.id },
    });
    expect(itemAudit?.reason).toBe('Pedido errado');

    // Service fee removed at the customer's request: waiter cannot; owner can (audited).
    await post(waiter, `/api/orders/${tab.id}/service-fee`, {
      expectedVersion: tab.version,
      waived: true,
      reason: 'Cliente pediu',
    }).expect(403);
    tab = (
      await post(owner, `/api/orders/${tab.id}/service-fee`, {
        expectedVersion: tab.version,
        waived: true,
        reason: 'Cliente pediu',
      }).expect(200)
    ).body;
    expect(tab).toMatchObject({ serviceFeeWaived: true, serviceFeeCents: 0, totalCents: 2500 });

    // Closing both tabs frees the table.
    tab = (
      await post(cashier, `/api/orders/${tab.id}/status`, {
        expectedVersion: tab.version,
        status: 'READY',
      }).expect(200)
    ).body;
    await post(cashier, `/api/orders/${tab.id}/status`, {
      expectedVersion: tab.version,
      status: 'DELIVERED',
    }).expect(200);
    expect((await get(waiter, '/api/tables')).body[0].session).not.toBeNull();
    await post(cashier, `/api/orders/${tab2.body.id}/status`, {
      expectedVersion: tab2.body.version,
      status: 'CANCELED',
      reason: 'Mesa foi embora',
    }).expect(200);
    expect((await get(waiter, '/api/tables')).body[0].session).toBeNull();
  });

  it('applies discounts and coupons with permissions and limits', async () => {
    await post(waiter, '/api/orders', {
      type: 'TAKEOUT',
      items: [burger()],
      orderDiscount: { type: 'VALUE', value: 100 },
      orderDiscountReason: 'Cortesia',
    }).expect(403);

    const discounted = await post(owner, '/api/orders', {
      type: 'TAKEOUT',
      items: [burger({ quantity: 2 })],
      orderDiscount: { type: 'PERCENT', value: 1000 },
      orderDiscountReason: 'Cliente frequente',
      couponCode: 'dez',
    }).expect(201);
    // 5000 → −10% (500) = 4500 → coupon 10% (450) = 4050
    expect(discounted.body).toMatchObject({
      subtotalCents: 5000,
      orderDiscountCents: 500,
      couponDiscountCents: 450,
      couponCode: 'DEZ',
      totalCents: 4050,
    });

    const below = await post(owner, '/api/orders', {
      type: 'TAKEOUT',
      items: [{ productId: ids.water, quantity: 1 }],
      couponCode: 'DEZ',
    }).expect(400);
    expect(below.body.message).toBe('Pedido abaixo do valor mínimo do cupom');
    const dez = await ctx.prisma.coupon.findFirst({
      where: { tenantId: store.storeId, code: 'DEZ' },
    });
    expect(dez?.usedCount).toBe(1); // the rejected order did not consume a use

    const results = await Promise.all(
      [1, 2].map(() =>
        post(owner, '/api/orders', { type: 'TAKEOUT', items: [burger()], couponCode: 'UNICO' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    const coupon = await ctx.prisma.coupon.findFirst({
      where: { tenantId: store.storeId, code: 'UNICO' },
    });
    expect(coupon?.usedCount).toBe(1);
  });

  it('isolates orders between units', async () => {
    const orders = await get(owner, '/api/orders?board=true').expect(200);
    const anyId = orders.body[0].id;
    await get(bearer(other.accessToken), `/api/orders/${anyId}`).expect(404);
    const otherList = await get(bearer(other.accessToken), '/api/orders').expect(200);
    expect(otherList.body).toEqual([]);
  });

  it('pushes realtime events only to authenticated sockets of the same unit', async () => {
    await ctx.app.listen(0);
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    const connect = (token: string) =>
      io(`http://127.0.0.1:${port}/realtime`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });

    const rejected = connect('invalid-token');
    await new Promise<void>((resolve) => rejected.on('disconnect', () => resolve()));
    rejected.close();

    const mine: Socket = connect(store.accessToken);
    const theirs: Socket = connect(other.accessToken);
    try {
      await Promise.all(
        [mine, theirs].map((s) => new Promise<void>((resolve) => s.on('ready', () => resolve()))),
      );
      const received: unknown[] = [];
      const leaked: unknown[] = [];
      theirs.on('order.created', (e) => leaked.push(e));
      const event = new Promise<{ id: string; status: string; version: number }>((resolve) =>
        mine.on('order.created', (e) => {
          received.push(e);
          resolve(e);
        }),
      );
      const created = await post(owner, '/api/orders', {
        type: 'TAKEOUT',
        items: [burger()],
      }).expect(201);
      const payload = await event;
      expect(payload).toMatchObject({ id: created.body.id, status: 'ACCEPTED', version: 0 });
      await new Promise((r) => setTimeout(r, 300));
      expect(leaked).toEqual([]);
    } finally {
      mine.close();
      theirs.close();
    }
  });
});
