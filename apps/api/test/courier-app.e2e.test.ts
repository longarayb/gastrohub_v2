import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { TRACKING_CONSENT_VERSION } from '@app/shared';
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

const APP = { 'X-App-Client': 'courier-app' };
const STORE = { latitude: -23.5649, longitude: -46.6519 };
const north = (km: number) => ({
  latitude: STORE.latitude + km / 111.2,
  longitude: STORE.longitude,
});
const RELEASE_DIR = path.join(process.cwd(), 'uploads', 'courier-app');

/** The Android courier app's API (D050): session, offline queue, notices and updates. */
describe('Courier Android app (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let owner: Headers;
  let courier: Headers;
  const ids: Record<string, string> = {};
  const orders: Order[] = [];

  const post = (h: Record<string, string>, url: string, body: object = {}) =>
    ctx.http().post(url).set(h).send(body);
  const get = (h: Headers, url: string) => ctx.http().get(url).set(h);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    rmSync(RELEASE_DIR, { recursive: true, force: true });
    store = await registerStore(ctx, { tradeName: 'App Teste' });
    owner = bearer(store.accessToken);
    await ctx.prisma.store.update({ where: { id: store.storeId }, data: STORE });
    const user = await post(owner, '/api/users', {
      name: 'Moto App',
      email: 'moto.app@teste.com',
      role: 'COURIER',
      password: 'Senha1234',
    }).expect(201);
    ids.user = user.body.id;
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
    ids.moto = (await post(owner, '/api/couriers', { name: 'Moto App' }).expect(201)).body.id;
    await ctx
      .http()
      .put(`/api/delivery/couriers/${ids.moto}`)
      .set(owner)
      .send({ name: 'Moto App', isActive: true, userId: ids.user })
      .expect(200);
    for (const km of [1, 2]) {
      let order: Order = (
        await post(owner, '/api/orders', {
          type: 'DELIVERY',
          customer: { name: 'Cliente', phone: `(11) 9${String(5000_0000 + km)}` },
          deliveryAddress: {
            cep: '01310100',
            street: 'Rua de Teste',
            number: String(km),
            neighborhood: 'Centro',
            city: 'São Paulo',
            state: 'SP',
          },
          items: [{ productId: ids.pizza, quantity: 1 }],
          expectedPaymentMethod: 'PIX',
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
      orders.push((await get(owner, `/api/orders/${order.id}`).expect(200)).body);
    }
  });

  afterAll(async () => {
    rmSync(RELEASE_DIR, { recursive: true, force: true });
    await ctx.app.close();
  });

  it('session: the refresh token comes in the body (no cookie) and a quick resend is tolerated', async () => {
    const login = await post(APP, '/api/auth/login', {
      email: 'moto.app@teste.com',
      password: 'Senha1234',
    }).expect(200);
    expect(login.headers['set-cookie']).toBeUndefined();
    expect(login.body.refreshToken).toEqual(expect.any(String));
    courier = bearer(login.body.accessToken);

    const first = await post(APP, '/api/auth/refresh', {
      refreshToken: login.body.refreshToken,
    }).expect(200);
    expect(first.body.refreshToken).not.toBe(login.body.refreshToken);
    // The answer got lost on the street: the same token again, seconds later, still works.
    const again = await post(APP, '/api/auth/refresh', {
      refreshToken: login.body.refreshToken,
    }).expect(200);
    expect(again.body.accessToken).toEqual(expect.any(String));
    // Without the app header the body is ignored (the panel uses the cookie only).
    await post({}, '/api/auth/refresh', { refreshToken: first.body.refreshToken }).expect(401);
    await post(APP, '/api/auth/refresh', { refreshToken: 'inventado' }).expect(401);
  });

  it('notices: the phone registers its Firebase token and gets "rota nova"', async () => {
    expect((await get(courier, '/api/push/config').expect(200)).body).toMatchObject({ fcm: true });
    const token = 'fcm-device-token-0123456789';
    await post(courier, '/api/push/subscriptions', { channel: 'FCM', token }).expect(204);
    await post(courier, '/api/push/subscriptions', { channel: 'FCM', token: 'curto' }).expect(400);
    await post(courier, '/api/courier/tracking/consent', {
      version: TRACKING_CONSENT_VERSION,
    }).expect(200);

    await post(owner, '/api/dispatch/runs', {
      courierId: ids.moto,
      orders: orders.map((o) => ({ orderId: o.id, expectedVersion: o.version })),
    }).expect(201);
    for (let i = 0; i < 50 && !ctx.push.sent.length; i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(ctx.push.sent[0]).toMatchObject({
      target: { endpoint: token, p256dh: null, auth: null },
      message: { title: '2 entregas na sua rota' },
    });
  });

  it('positions tell how many stops are left (the app stops sharing at zero)', async () => {
    const res = await post(courier, '/api/courier/positions', {
      positions: [{ ...north(0.2), accuracyMeters: 10, recordedAt: new Date().toISOString() }],
    }).expect(200);
    expect(res.body).toMatchObject({ accepted: 1, pendingStops: 2 });
  });

  it('offline queue: the same action twice is applied once, with the time the phone recorded', async () => {
    const me = (await get(courier, '/api/courier/me').expect(200)).body;
    const [first, second] = me.run.stops as { stopId: string }[];
    // Delivered without signal right after leaving: the phone's time is kept.
    const dispatched = await ctx.prisma.deliveryStop.findUniqueOrThrow({
      where: { id: first!.stopId },
    });
    const occurredAt = new Date(dispatched.dispatchedAt.getTime() + 500).toISOString();
    const deliver = {
      collection: { method: 'PIX', amountCents: 4500 },
      actionId: 'acao-entregue-0001',
      occurredAt,
    };
    await post(courier, `/api/courier/stops/${first!.stopId}/deliver`, deliver).expect(200);
    // The answer was lost: the queue sends it again.
    const resend = await post(
      courier,
      `/api/courier/stops/${first!.stopId}/deliver`,
      deliver,
    ).expect(200);
    expect(resend.body.run.stops[0].status).toBe('DELIVERED');
    // Another action on a concluded stop is still refused.
    await post(courier, `/api/courier/stops/${first!.stopId}/fail`, {
      reason: 'CUSTOMER_ABSENT',
      actionId: 'acao-outra-0002',
    }).expect(400);
    const stop = await ctx.prisma.deliveryStop.findUniqueOrThrow({ where: { id: first!.stopId } });
    expect(stop.deliveredAt?.toISOString()).toBe(occurredAt);
    const history = await ctx.prisma.orderStatusHistory.count({
      where: { orderId: orders[0]!.id, toStatus: 'DELIVERED' },
    });
    expect(history).toBe(1);

    await post(courier, `/api/courier/stops/${second!.stopId}/fail`, {
      reason: 'CUSTOMER_ABSENT',
      actionId: 'acao-falha-0003',
      // A time before the departure is not plausible: the server time counts.
      occurredAt: new Date(Date.now() - 86_400_000).toISOString(),
    }).expect(200);
    const failed = await ctx.prisma.deliveryStop.findUniqueOrThrow({
      where: { id: second!.stopId },
    });
    expect(failed.failedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    await post(courier, `/api/courier/stops/${second!.stopId}/fail`, {
      reason: 'CUSTOMER_ABSENT',
      actionId: 'acao-falha-0003',
    }).expect(200);
  });

  it('updates: the latest APK published on the server, public', async () => {
    await ctx.http().get('/api/courier-app/latest').expect(404);
    mkdirSync(RELEASE_DIR, { recursive: true });
    writeFileSync(path.join(RELEASE_DIR, 'entregas-3.apk'), 'apk');
    writeFileSync(
      path.join(RELEASE_DIR, 'latest.json'),
      JSON.stringify({
        versionCode: 3,
        versionName: '1.0.2',
        notes: 'Correções',
        file: 'entregas-3.apk',
        publishedAt: '2026-10-16T12:00:00.000Z',
      }),
    );
    const latest = await ctx.http().get('/api/courier-app/latest').expect(200);
    expect(latest.body).toEqual({
      versionCode: 3,
      versionName: '1.0.2',
      notes: 'Correções',
      downloadPath: '/api/courier-app/download',
      publishedAt: '2026-10-16T12:00:00.000Z',
    });
    const apk = await ctx.http().get('/api/courier-app/download').expect(200);
    expect(apk.headers['content-type']).toBe('application/vnd.android.package-archive');
    // A path in the JSON never leaves the folder.
    writeFileSync(
      path.join(RELEASE_DIR, 'latest.json'),
      JSON.stringify({ versionCode: 4, versionName: 'x', file: '../../.env', publishedAt: '' }),
    );
    await ctx.http().get('/api/courier-app/download').expect(404);
  });
});
