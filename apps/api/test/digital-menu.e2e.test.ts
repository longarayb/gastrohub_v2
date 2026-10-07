import type { AddressInfo } from 'node:net';
import { io } from 'socket.io-client';
import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

type Headers = { Authorization: string };

const address = (neighborhood: string) => ({
  cep: '01310100',
  street: 'Rua do Cardápio',
  number: '10',
  neighborhood,
  city: 'São Paulo',
  state: 'SP',
});

/** Digital menu: public menu, cart, orders with limits, rejection, tracking, PIX (D032–D034). */
describe('Digital menu (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let other: RegisteredStore;
  let owner: Headers;
  let cashier: Headers;
  let slug: string;
  let otherSlug: string;
  const ids: Record<string, string> = {};

  const post = (h: Headers | null, url: string, body: object = {}) =>
    h ? ctx.http().post(url).set(h).send(body) : ctx.http().post(url).send(body);
  const put = (h: Headers, url: string, body: object = {}) => ctx.http().put(url).set(h).send(body);
  const get = (h: Headers | null, url: string) =>
    h ? ctx.http().get(url).set(h) : ctx.http().get(url);
  const patch = (h: Headers, url: string, body: object = {}) =>
    ctx.http().patch(url).set(h).send(body);

  let phoneSeq = 0;
  const nextPhone = () => `(11) 9${String(7000_0000 + ++phoneSeq)}`;
  const items = (quantity = 1) => [{ productId: ids.burger, quantity }];
  const preview = (body: object, s = slug) => post(null, `/api/public/${s}/cart`, body);

  /** Places an order with the total the preview shows (as the menu app does). */
  async function order(extra: Record<string, unknown> = {}, expectStatus = 201) {
    const cart = {
      type: 'TAKEOUT',
      items: items(),
      ...(extra.cart as object | undefined),
    };
    const p = (await preview(cart).expect(200)).body;
    const { cart: _cart, ...rest } = extra;
    return post(null, `/api/public/${slug}/orders`, {
      ...cart,
      customer: { name: 'Cliente Cardápio', phone: nextPhone() },
      expectedPaymentMethod: 'CASH',
      acceptPrivacy: true,
      expectedTotalCents: p.totalCents,
      formStartedAt: Date.now() - 20_000,
      ...rest,
    }).expect(expectStatus);
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Cantina Digital' });
    other = await registerStore(ctx, { tradeName: 'Outra Cantina' });
    owner = bearer(store.accessToken);
    slug = (await ctx.prisma.store.findUniqueOrThrow({ where: { id: store.storeId } })).slug;
    otherSlug = (await ctx.prisma.store.findUniqueOrThrow({ where: { id: other.storeId } })).slug;

    await post(owner, '/api/users', {
      name: 'Caixa',
      email: 'caixa.cardapio@teste.com',
      role: 'CASHIER',
      password: 'Senha1234',
    }).expect(201);
    cashier = bearer(
      (
        await ctx
          .http()
          .post('/api/auth/login')
          .send({ email: 'caixa.cardapio@teste.com', password: 'Senha1234' })
          .expect(200)
      ).body.accessToken,
    );

    // Always open (no opening hours): the tests must not depend on the clock.
    await put(owner, '/api/stores/current/hours', { hours: [] }).expect(200);
    const category = await post(owner, '/api/menu/categories', { name: 'Lanches' }).expect(201);
    ids.burger = (
      await post(owner, '/api/menu/products', {
        categoryId: category.body.id,
        name: 'X-Burger',
        priceCents: 2500,
      }).expect(201)
    ).body.id;
    await post(owner, '/api/delivery/areas', {
      name: 'Centro',
      neighborhoods: ['Centro'],
      feeCents: 500,
      etaMinutes: 40,
      minimumOrderCents: 3000,
      freeAboveCents: 10_000,
    }).expect(201);
    const paused = await post(owner, '/api/delivery/areas', {
      name: 'Pinheiros',
      neighborhoods: ['Pinheiros'],
      feeCents: 900,
      etaMinutes: 50,
    }).expect(201);
    await post(owner, `/api/delivery/areas/${paused.body.id}/pause`, { reason: 'Chuva' }).expect(
      200,
    );
    await post(owner, '/api/coupons', { code: 'DEZ', type: 'PERCENT', value: 1000 }).expect(201);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('public restaurant: its own brand, open state and privacy template; unknown slug 404', async () => {
    await put(owner, '/api/digital-menu/settings', {
      digitalMenuEnabled: true,
      autoAcceptDigitalOrders: false,
      brandColor: '#1D3557',
      menuDescription: 'Lanches artesanais',
      privacyNotice: null,
      limitPerPhoneOpen: 2,
      limitPerPhoneDay: 10,
      limitPerIpHour: 30,
      limitStorePending: 20,
    }).expect(200);
    await put(cashier, '/api/digital-menu/settings', {}).expect(403);
    const bad = await put(owner, '/api/digital-menu/settings', {
      digitalMenuEnabled: true,
      autoAcceptDigitalOrders: false,
      brandColor: 'azul',
      limitPerPhoneOpen: 2,
      limitPerPhoneDay: 10,
      limitPerIpHour: 30,
      limitStorePending: 20,
    }).expect(400);
    expect(bad.body.details).toEqual([
      { path: 'brandColor', message: 'Cor inválida (use #RRGGBB)' },
    ]);

    const pub = (await get(null, `/api/public/${slug}`).expect(200)).body;
    expect(pub).toMatchObject({
      slug,
      name: 'Cantina Digital',
      brandColor: '#1D3557',
      description: 'Lanches artesanais',
      accepting: true,
      delivers: true,
      openState: { open: true, nextOpening: null },
      paymentMethods: ['CASH', 'PIX', 'CREDIT_CARD', 'DEBIT_CARD', 'MEAL_VOUCHER'],
    });
    expect(pub.privacyNotice).toMatch(/é o responsável \(controlador\)/);
    expect(pub.privacyVersion).toBeTruthy();
    await get(null, '/api/public/nao-existe').expect(404);

    const catalog = (await get(null, `/api/public/${slug}/catalog`).expect(200)).body;
    expect(catalog.channel).toBe('DIGITAL_MENU');
    expect(catalog.categories[0].products[0]).toMatchObject({ name: 'X-Burger' });
  });

  it('cart preview: server totals, coupon, delivery area, minimum and clear messages', async () => {
    const takeout = (
      await preview({ type: 'TAKEOUT', items: items(2), couponCode: 'dez' }).expect(200)
    ).body;
    expect(takeout).toMatchObject({
      subtotalCents: 5000,
      couponDiscountCents: 500,
      totalCents: 4500,
      coupon: { code: 'DEZ', applied: true },
      canOrder: true,
    });
    const badCoupon = (
      await preview({ type: 'TAKEOUT', items: items(), couponCode: 'NAOEXISTE' }).expect(200)
    ).body;
    expect(badCoupon.coupon).toEqual({
      code: 'NAOEXISTE',
      applied: false,
      message: 'Cupom inválido',
    });
    expect(badCoupon.canOrder).toBe(true);

    // Below the minimum of the area (R$ 30,00), with how much is missing for free delivery.
    const below = (
      await preview({
        type: 'DELIVERY',
        items: items(),
        deliveryAddress: address('Centro'),
      }).expect(200)
    ).body;
    expect(below.delivery).toMatchObject({
      ok: true,
      areaName: 'Centro',
      feeCents: 500,
      etaMinutes: 40,
      belowMinimum: true,
      missingForFreeCents: 7500,
    });
    expect(below).toMatchObject({
      canOrder: false,
      blockingMessage: 'Pedido mínimo para entrega: R$ 30,00.',
    });
    const ok = (
      await preview({
        type: 'DELIVERY',
        items: items(2),
        deliveryAddress: address('centro'),
      }).expect(200)
    ).body;
    expect(ok).toMatchObject({ deliveryFeeCents: 500, totalCents: 5500, canOrder: true });

    const out = (
      await preview({
        type: 'DELIVERY',
        items: items(2),
        deliveryAddress: address('Moema'),
      }).expect(200)
    ).body;
    expect(out.blockingMessage).toBe(
      'Ainda não entregamos em Moema. Você pode retirar no restaurante.',
    );
    const paused = (
      await preview({
        type: 'DELIVERY',
        items: items(2),
        deliveryAddress: address('Pinheiros'),
      }).expect(200)
    ).body;
    expect(paused.blockingMessage).toBe(
      'Entrega temporariamente indisponível para Pinheiros (Chuva). Que tal retirar no local?',
    );
    // The miss feeds "Bairros sem área" (once per neighborhood in a window).
    await preview({ type: 'DELIVERY', items: items(2), deliveryAddress: address('Moema') });
    const misses = await ctx.prisma.deliveryQuoteMiss.findMany({
      where: { tenantId: store.storeId },
    });
    expect(misses.map((m) => [m.neighborhood, m.reason]).sort()).toEqual([
      ['Moema', 'OUT_OF_AREA'],
      ['Pinheiros', 'PAUSED'],
    ]);
    // Out-of-area searches show up in "Bairros sem área" (a paused area is not missing).
    const unmatched = (await get(owner, '/api/delivery/areas/unmatched').expect(200)).body;
    expect(unmatched.map((u: { neighborhood: string }) => u.neighborhood)).toEqual(['Moema']);

    const gone = (
      await preview({ type: 'TAKEOUT', items: [{ productId: 'nao-existe', quantity: 1 }] }).expect(
        200,
      )
    ).body;
    expect(gone.changes).toEqual([expect.objectContaining({ key: '0', kind: 'UNAVAILABLE' })]);
    expect(gone.canOrder).toBe(false);
  });

  it('closed store or paused receiving: the menu shows, ordering is blocked', async () => {
    const now = new Date();
    const weekday = (new Date(now.getTime() - 3 * 3_600_000).getUTCDay() + 3) % 7;
    await put(owner, '/api/stores/current/hours', {
      hours: [{ weekday, opensAt: '11:00', closesAt: '15:00' }],
    }).expect(200);
    const pub = (await get(null, `/api/public/${slug}`).expect(200)).body;
    expect(pub.openState.open).toBe(false);
    expect(pub.openState.nextOpening.label).toMatch(/às 11:00$/);
    const closed = (await preview({ type: 'TAKEOUT', items: items() }).expect(200)).body;
    expect(closed.blockingMessage).toMatch(/^Fechado agora\. Abre .* às 11:00\.$/);
    await put(owner, '/api/stores/current/hours', { hours: [] }).expect(200);
  });

  it('orders: bots, changed totals, LGPD consent, idempotency and the phone limit', async () => {
    const p = (await preview({ type: 'TAKEOUT', items: items() }).expect(200)).body;
    const base = {
      type: 'TAKEOUT',
      items: items(),
      customer: { name: 'Joana', phone: '(11) 98888-1111' },
      expectedPaymentMethod: 'CASH',
      changeForCents: 5000,
      acceptPrivacy: true,
      marketingOptIn: true,
      expectedTotalCents: p.totalCents,
      formStartedAt: Date.now() - 20_000,
    };
    const url = `/api/public/${slug}/orders`;
    // Honeypot and instant submit: a generic message.
    const bot = await post(null, url, { ...base, website: 'http://spam' }).expect(400);
    expect(bot.body.message).toBe(
      'Não foi possível enviar o pedido. Confira os dados e tente de novo.',
    );
    await post(null, url, { ...base, formStartedAt: Date.now() }).expect(400);
    const noConsent = await post(null, url, { ...base, acceptPrivacy: false }).expect(400);
    expect(noConsent.body.details[0].message).toBe('Aceite o aviso de privacidade para continuar');
    const landline = await post(null, url, {
      ...base,
      customer: { name: 'Joana', phone: '(11) 3456-7890' },
    }).expect(400);
    expect(landline.body.details[0].message).toBe('Informe um celular com DDD');
    const changed = await post(null, url, { ...base, expectedTotalCents: 100 }).expect(409);
    expect(changed.body.message).toBe(
      'Os valores do pedido mudaram. Confira o carrinho antes de enviar.',
    );
    expect(changed.body.details.totalCents).toBe(p.totalCents);

    const key = 'pedido-cardapio-0001';
    const first = await ctx.http().post(url).set('Idempotency-Key', key).send(base).expect(201);
    expect(first.body.trackingToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
    const again = await ctx.http().post(url).set('Idempotency-Key', key).send(base).expect(201);
    expect(again.body).toEqual(first.body);
    ids.joanaToken = first.body.trackingToken;

    const saved = await ctx.prisma.order.findFirstOrThrow({
      where: { trackingToken: first.body.trackingToken },
      include: { customer: true },
    });
    expect(saved).toMatchObject({
      source: 'DIGITAL_MENU',
      status: 'PENDING',
      expectedPaymentMethod: 'CASH',
      changeForCents: 5000,
      createdById: null,
    });
    expect(saved.clientIpHash).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(saved.customer).toMatchObject({
      marketingOptIn: true,
      privacyVersion: expect.any(String),
    });
    expect(saved.customer?.privacyAcceptedAt).toBeInstanceOf(Date);
    ids.joanaOrder = saved.id;

    // Main protection: 2 orders in progress per phone.
    await post(null, url, base).expect(201);
    const third = await post(null, url, base).expect(400);
    expect(third.body.message).toBe(
      'Você já tem pedidos em andamento neste restaurante. Acompanhe-os antes de fazer outro.',
    );
  });

  it('IP limit is wide (CGNAT) and configurable; store pending limit', async () => {
    const settings = (await get(owner, '/api/digital-menu/settings').expect(200)).body;
    await put(owner, '/api/digital-menu/settings', {
      ...settings,
      limitPerIpHour: 5,
    }).expect(200);
    // 2 orders so far from this IP (the idempotent retry is not a new one): 3 more allowed.
    await order();
    await order();
    await order();
    const blocked = await order({}, 400);
    expect(blocked.body.message).toBe(
      'Muitos pedidos a partir desta conexão. Tente de novo mais tarde.',
    );
    await put(owner, '/api/digital-menu/settings', {
      ...settings,
      limitPerIpHour: 1000,
      limitStorePending: 5,
    }).expect(200);
    const busy = await order({}, 400);
    expect(busy.body.message).toBe(
      'O restaurante está com muitos pedidos agora. Tente de novo em alguns minutos.',
    );
    await put(owner, '/api/digital-menu/settings', settings).expect(200);
  });

  it('refusal: reason for the customer, internal note kept apart, phone blocked', async () => {
    const pending = await ctx.prisma.order.findMany({
      where: { tenantId: store.storeId, source: 'DIGITAL_MENU', status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    const target = pending.find((o) => o.id !== ids.joanaOrder)!;
    const noText = await post(cashier, `/api/orders/${target.id}/reject`, {
      expectedVersion: target.version,
      reason: 'OTHER',
    }).expect(400);
    expect(noText.body.details[0].message).toBe('Escreva o motivo que o cliente vai ver');
    const refused = (
      await post(cashier, `/api/orders/${target.id}/reject`, {
        expectedVersion: target.version,
        reason: 'OTHER',
        reasonText: 'Acabou o pão hoje',
        internalNote: 'Telefone de trote conhecido',
        blockPhone: true,
      }).expect(200)
    ).body;
    expect(refused).toMatchObject({
      status: 'CANCELED',
      cancelReason: 'Telefone de trote conhecido',
      rejection: { reason: 'OTHER', customerMessage: 'Acabou o pão hoje' },
    });
    const tracking = (
      await get(null, `/api/public/${slug}/orders/${target.trackingToken}`).expect(200)
    ).body;
    expect(tracking.canceled).toEqual({ message: 'Acabou o pão hoje' });
    expect(JSON.stringify(tracking)).not.toContain('trote');

    // The blocked phone gets a neutral message.
    const blockedList = (await get(owner, '/api/digital-menu/blocked-phones').expect(200)).body;
    expect(blockedList).toEqual([
      expect.objectContaining({
        phone: target.customerPhone,
        reason: 'Telefone de trote conhecido',
      }),
    ]);
    const p = (await preview({ type: 'TAKEOUT', items: items() }).expect(200)).body;
    const neutral = await post(null, `/api/public/${slug}/orders`, {
      type: 'TAKEOUT',
      items: items(),
      customer: { name: 'Trote', phone: target.customerPhone },
      expectedPaymentMethod: 'CASH',
      acceptPrivacy: true,
      expectedTotalCents: p.totalCents,
      formStartedAt: Date.now() - 20_000,
    }).expect(400);
    expect(neutral.body.message).toMatch(
      /^Não foi possível concluir o pedido pelo cardápio\. Ligue/,
    );
    await ctx
      .http()
      .delete(`/api/digital-menu/blocked-phones/${blockedList[0].id}`)
      .set(owner)
      .expect(200);

    // Rejection is only for digital menu orders.
    const pos = await post(owner, '/api/orders', { type: 'TAKEOUT', items: items() }).expect(201);
    await post(owner, `/api/orders/${pos.body.id}/reject`, {
      expectedVersion: pos.body.version,
      reason: 'TOO_BUSY',
    }).expect(400);
  });

  it('tracking: timeline, PIX after acceptance, "Já paguei" and realtime', async () => {
    await patch(owner, '/api/stores/current/pix', {
      pixKeyType: 'EMAIL',
      pixKey: 'pix@cantina.com',
      pixMerchantName: 'Cantina Digital',
      pixMerchantCity: 'São Paulo',
    }).expect(200);
    const created = (
      await order({
        cart: { type: 'DELIVERY', items: items(2), deliveryAddress: address('Centro') },
        expectedPaymentMethod: 'PIX',
      })
    ).body;
    const url = `/api/public/${slug}/orders/${created.trackingToken}`;
    const pending = (await get(null, url).expect(200)).body;
    expect(pending).toMatchObject({
      status: 'PENDING',
      type: 'DELIVERY',
      totalCents: 5500,
      deliveryFeeCents: 500,
      neighborhood: 'Centro',
      paymentMethod: 'PIX',
      pix: null,
      canceled: null,
    });
    expect(pending.steps.find((s: { current: boolean }) => s.current).key).toBe('RECEIVED');
    // No personal data of the customer on the tracking page (the restaurant phone is shown).
    const row = await ctx.prisma.order.findFirstOrThrow({
      where: { trackingToken: created.trackingToken },
    });
    const json = JSON.stringify(pending);
    for (const personal of [row.customerPhone!, row.customerName!, 'Rua do Cardápio']) {
      expect(json).not.toContain(personal);
    }
    await post(null, `${url}/pix-reported`).expect(400);

    // Other restaurant, same token: not found.
    await get(null, `/api/public/${otherSlug}/orders/${created.trackingToken}`).expect(404);
    await get(null, `/api/public/${slug}/orders/token-que-nao-existe-123`).expect(404);

    await ctx.app.listen(0);
    const { port } = ctx.app.getHttpServer().address() as AddressInfo;
    const bad = io(`http://127.0.0.1:${port}/tracking`, {
      auth: { token: 'nao-existe-0000000000' },
      transports: ['websocket'],
      reconnection: false,
    });
    await new Promise<void>((resolve) => bad.on('disconnect', () => resolve()));
    bad.close();
    const socket = io(`http://127.0.0.1:${port}/tracking`, {
      auth: { token: created.trackingToken },
      transports: ['websocket'],
      reconnection: false,
    });
    try {
      await new Promise<void>((resolve) => socket.on('ready', () => resolve()));
      const update = new Promise<{ status: string }>((resolve) =>
        socket.on('tracking.updated', (e) => resolve(e)),
      );
      const detail = await ctx.prisma.order.findFirstOrThrow({
        where: { trackingToken: created.trackingToken },
      });
      await post(cashier, `/api/orders/${detail.id}/status`, {
        expectedVersion: detail.version,
        status: 'ACCEPTED',
      }).expect(200);
      expect(await update).toMatchObject({ status: 'ACCEPTED' });
    } finally {
      socket.close();
    }

    const accepted = (await get(null, url).expect(200)).body;
    expect(accepted.pix).toMatchObject({ amountCents: 5500 });
    expect(accepted.pix.brCode).toContain('pix@cantina.com');
    expect(accepted.estimatedAt).toBeTruthy();
    const reported = (await post(null, `${url}/pix-reported`).expect(200)).body;
    expect(reported.pixReportedAt).toBeTruthy();
    // Visible on the board for the register to check (not paid yet).
    const board = (await get(cashier, '/api/orders?board=true').expect(200)).body;
    const card = board.find((o: { number: number }) => o.number === created.number);
    expect(card).toMatchObject({ pixReportedAt: reported.pixReportedAt, paymentStatus: 'UNPAID' });
  });

  it('automatic acceptance when configured', async () => {
    const settings = (await get(owner, '/api/digital-menu/settings').expect(200)).body;
    await put(owner, '/api/digital-menu/settings', {
      ...settings,
      autoAcceptDigitalOrders: true,
    }).expect(200);
    const created = (await order()).body;
    const tracking = (
      await get(null, `/api/public/${slug}/orders/${created.trackingToken}`).expect(200)
    ).body;
    expect(tracking.status).toBe('ACCEPTED');
    await put(owner, '/api/digital-menu/settings', settings).expect(200);
  });
});
