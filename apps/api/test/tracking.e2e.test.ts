import { TRACKING_CONSENT_VERSION } from '@app/shared';
import { LiveEtaService } from '../src/modules/dispatch/live-eta.service.js';
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
  number: number;
  version: number;
  [key: string]: unknown;
}

const STORE = { latitude: -23.5649, longitude: -46.6519 };
const north = (km: number) => ({
  latitude: STORE.latitude + km / 111.2,
  longitude: STORE.longitude,
});
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

/** Courier location sharing, live arrivals and "rota nova" push (D049). */
describe('Courier tracking and push (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let other: RegisteredStore;
  let owner: Headers;
  let courier: Headers;
  const ids: Record<string, string> = {};
  const orders: Order[] = [];

  const post = (h: Headers, url: string, body: object = {}) =>
    ctx.http().post(url).set(h).send(body);
  const get = (h: Headers, url: string) => ctx.http().get(url).set(h);
  const send = (positions: object[]) => post(courier, '/api/courier/positions', { positions });

  let phone = 0;
  async function readyDelivery(km: number): Promise<Order> {
    let order: Order = (
      await post(owner, '/api/orders', {
        type: 'DELIVERY',
        customer: { name: 'Cliente', phone: `(11) 9${String(6000_0000 + ++phone)}` },
        deliveryAddress: {
          cep: '01310100',
          street: 'Rua de Teste',
          number: String(km * 100),
          neighborhood: 'Centro',
          city: 'São Paulo',
          state: 'SP',
        },
        items: [{ productId: ids.pizza, quantity: 1 }],
      }).expect(201)
    ).body;
    for (const status of ['PREPARING', 'READY']) {
      order = (
        await post(owner, `/api/orders/${order.id}/status`, {
          expectedVersion: order.version,
          status,
        }).expect(200)
      ).body;
    }
    await ctx
      .http()
      .patch(`/api/dispatch/orders/${order.id}/location`)
      .set(owner)
      .send(north(km))
      .expect(200);
    return (await get(owner, `/api/orders/${order.id}`).expect(200)).body;
  }

  async function waitFor<T>(fn: () => T | Promise<T>, ok: (v: T) => boolean): Promise<T> {
    for (let i = 0; i < 50; i++) {
      const value = await fn();
      if (ok(value)) return value;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('timeout');
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Rastreio Teste' });
    other = await registerStore(ctx, { tradeName: 'Outra Loja' });
    owner = bearer(store.accessToken);
    await ctx.prisma.store.update({ where: { id: store.storeId }, data: STORE });

    const user = await post(owner, '/api/users', {
      name: 'Moto',
      email: 'moto.rastreio@teste.com',
      role: 'COURIER',
      password: 'Senha1234',
    }).expect(201);
    const login = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: 'moto.rastreio@teste.com', password: 'Senha1234' })
      .expect(200);
    courier = bearer(login.body.accessToken);

    await post(owner, '/api/delivery/areas', {
      name: 'Centro',
      neighborhoods: ['Centro'],
      feeCents: 500,
      etaMinutes: 30,
    }).expect(201);
    const category = await post(owner, '/api/menu/categories', { name: 'Pizzas' }).expect(201);
    ids.pizza = (
      await post(owner, '/api/menu/products', {
        categoryId: category.body.id,
        name: 'Pizza',
        priceCents: 4000,
      }).expect(201)
    ).body.id;
    ids.moto = (await post(owner, '/api/couriers', { name: 'Moto' }).expect(201)).body.id;
    await ctx
      .http()
      .put(`/api/delivery/couriers/${ids.moto}`)
      .set(owner)
      .send({ name: 'Moto', isActive: true, userId: user.body.id })
      .expect(200);
    for (const km of [2, 1]) orders.push(await readyDelivery(km));
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('consent: required, only the current text version, audited', async () => {
    const me = (await get(courier, '/api/courier/me').expect(200)).body;
    expect(me.tracking).toMatchObject({
      storeName: 'Rastreio Teste',
      consentVersion: null,
      storedPositions: 0,
    });
    await send([{ ...north(0.1), recordedAt: ago(1) }]).expect(403);
    await post(courier, '/api/courier/tracking/consent', { version: 'antiga' }).expect(400);
    await post(owner, '/api/courier/tracking/consent', {
      version: TRACKING_CONSENT_VERSION,
    }).expect(403);
    const accepted = await post(courier, '/api/courier/tracking/consent', {
      version: TRACKING_CONSENT_VERSION,
    }).expect(200);
    expect(accepted.body.consentVersion).toBe(TRACKING_CONSENT_VERSION);
    expect(
      await ctx.prisma.auditLog.count({
        where: { tenantId: store.storeId, action: 'courier.tracking_consent' },
      }),
    ).toBe(1);
    // Without an open run nothing is accepted.
    const noRun = await send([{ ...north(0.1), recordedAt: ago(1) }]).expect(400);
    expect(noRun.body.message).toMatch(/Nenhuma saída aberta/);
  });

  it('push: the courier subscribes and gets "rota nova" when orders leave', async () => {
    expect((await get(courier, '/api/push/config').expect(200)).body).toEqual({
      publicKey: 'test-public-key',
    });
    const subscription = {
      endpoint: 'https://push.example.com/send/abc',
      keys: { p256dh: 'p256dh-key', auth: 'auth-secret' },
    };
    await post(courier, '/api/push/subscriptions', subscription).expect(204);
    await post(courier, '/api/push/subscriptions', { endpoint: 'nao-e-url' }).expect(400);
    // An old subscription the push service no longer knows is deleted on the first send.
    await post(courier, '/api/push/subscriptions', {
      ...subscription,
      endpoint: 'https://push.example.com/send/gone',
    }).expect(204);
    ctx.push.gone.add('https://push.example.com/send/gone');

    await post(owner, '/api/dispatch/runs', {
      courierId: ids.moto,
      orders: orders.map((o) => ({ orderId: o.id, expectedVersion: o.version })),
    }).expect(201);
    const sent = await waitFor(
      () => ctx.push.sent,
      (s) => s.length > 0,
    );
    expect(sent[0]).toMatchObject({
      target: { endpoint: subscription.endpoint, p256dh: 'p256dh-key', auth: 'auth-secret' },
      message: { title: '2 entregas na sua rota', url: '/entregas' },
    });
    await waitFor(
      () => ctx.prisma.pushSubscription.count({ where: { tenantId: store.storeId } }),
      (n) => n === 1,
    );
    // Turning the notices off removes the subscription.
    await ctx
      .http()
      .delete('/api/push/subscriptions')
      .set(courier)
      .send({ endpoint: subscription.endpoint })
      .expect(204);
    expect(await ctx.prisma.pushSubscription.count({ where: { tenantId: store.storeId } })).toBe(0);
  });

  it('positions: own open run only, thinned before storing, live on the dispatch map', async () => {
    await post(owner, '/api/courier/positions', {
      positions: [{ ...north(0.1), recordedAt: ago(1) }],
    }).expect(403);
    ctx.app.get(LiveEtaService).reset();
    const res = await send([
      { ...north(0.1), accuracyMeters: 10, recordedAt: ago(25) },
      // Stopped 3 s later: not stored (sent to the map only when it is the latest).
      { ...north(0.1), accuracyMeters: 10, recordedAt: ago(22) },
      // Imprecise (cell tower): ignored.
      { ...north(0.5), accuracyMeters: 1500, recordedAt: ago(21) },
      // From the future (wrong clock): ignored.
      { ...north(0.5), recordedAt: new Date(Date.now() + 10 * 60_000).toISOString() },
      { ...north(0.3), accuracyMeters: 10, recordedAt: ago(2) },
    ]).expect(200);
    expect(res.body).toEqual({ accepted: 3, stored: 2 });

    const board = (await get(owner, '/api/dispatch/board').expect(200)).body;
    const run = board.couriers.find((c: { id: string }) => c.id === ids.moto).run;
    expect(run.position).toMatchObject({ ...north(0.3), simulated: false });
    // Arrivals recalculated from the position: the line starts where the courier is.
    expect(run.geometry[0]).toEqual([north(0.3).longitude, north(0.3).latitude]);
    expect(run.stops.every((s: { etaAt: string | null }) => s.etaAt)).toBe(true);

    const me = (await get(courier, '/api/courier/me').expect(200)).body;
    expect(me.tracking.storedPositions).toBe(2);
    expect(me.run.geometry[0]).toEqual([north(0.3).longitude, north(0.3).latitude]);
    // In the dispatched order (2 km first, as sent).
    expect(me.run.stops.map((s: { location: unknown }) => s.location)).toEqual([
      north(2),
      north(1),
    ]);

    // Another unit sees nothing.
    const foreign = (await get(bearer(other.accessToken), '/api/dispatch/board').expect(200)).body;
    expect(foreign.couriers).toEqual([]);
  });

  it('a concluded stop recalculates the rest of the route from the next position', async () => {
    const me = (await get(courier, '/api/courier/me').expect(200)).body;
    const first = me.run.stops.find((s: { orderNumber: number }) => s.orderNumber === 2);
    await post(courier, `/api/courier/stops/${first.stopId}/deliver`, {
      collection: { method: 'CASH', amountCents: 4500, receivedCents: 5000, note: null },
    }).expect(200);
    await send([{ ...north(1), accuracyMeters: 10, recordedAt: ago(0) }]).expect(200);
    const run = (await get(courier, '/api/courier/me').expect(200)).body.run;
    // From the courier (1 km) to the last stop (2 km): two points in a straight line.
    expect(run.geometry).toEqual([
      [north(1).longitude, north(1).latitude],
      [north(2).longitude, north(2).latitude],
    ]);
  });
});
