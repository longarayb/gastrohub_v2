import { OrderLocationService } from '../src/modules/dispatch/order-location.service.js';
import { PositionsService } from '../src/modules/dispatch/positions.service.js';
import { SimulationService } from '../src/modules/dispatch/simulation.service.js';
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
/** Points north of the store, ~1, ~2 and ~3 km away. */
const north = (km: number) => ({
  latitude: STORE.latitude + km / 111.2,
  longitude: STORE.longitude,
});

/** Dispatch map: location queue, pin correction, route suggestion, dispatch, simulation (D048). */
describe('Dispatch (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let other: RegisteredStore;
  let owner: Headers;
  let waiter: Headers;
  const ids: Record<string, string> = {};
  const orders: Order[] = [];

  const post = (h: Headers, url: string, body: object = {}) =>
    ctx.http().post(url).set(h).send(body);
  const patch = (h: Headers, url: string, body: object = {}) =>
    ctx.http().patch(url).set(h).send(body);
  const get = (h: Headers, url: string) => ctx.http().get(url).set(h);

  let phone = 0;
  async function readyDelivery(number: string): Promise<Order> {
    let order: Order = (
      await post(owner, '/api/orders', {
        type: 'DELIVERY',
        customer: { name: 'Cliente', phone: `(11) 9${String(7000_0000 + ++phone)}` },
        deliveryAddress: {
          cep: '01310100',
          street: 'Rua de Teste',
          number,
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
    return order;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Despacho Teste' });
    other = await registerStore(ctx, { tradeName: 'Outra Unidade' });
    owner = bearer(store.accessToken);
    await ctx.prisma.store.update({ where: { id: store.storeId }, data: STORE });

    await post(owner, '/api/users', {
      name: 'Garçom',
      email: 'garcom.despacho@teste.com',
      role: 'WAITER',
      password: 'Senha1234',
    }).expect(201);
    const login = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: 'garcom.despacho@teste.com', password: 'Senha1234' })
      .expect(200);
    waiter = bearer(login.body.accessToken);

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
    for (const number of ['300', '100', '200']) orders.push(await readyDelivery(number));
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('board: orders without coordinates are located once in the background', async () => {
    await get(waiter, '/api/dispatch/board').expect(403);
    const first = (await get(owner, '/api/dispatch/board').expect(200)).body;
    expect(first.store.location).toEqual(STORE);
    expect(first.routing).toBe('STRAIGHT');
    expect(first.simulationAllowed).toBe(true);
    expect(first.orders).toHaveLength(3);
    expect(first.orders[0]).toMatchObject({ location: null, locating: true });
    expect(first.orders[0].addressLine).toMatch(/^Rua de Teste, \d00$/);
    expect(first.couriers).toEqual([
      expect.objectContaining({ id: ids.moto, status: 'FREE', run: null, simulated: false }),
    ]);

    // The test geocoder finds nothing: tried once, then the operator marks it on the map.
    await ctx.app.get(OrderLocationService).idle();
    const second = (await get(owner, '/api/dispatch/board').expect(200)).body;
    expect(second.orders.every((o: { locating: boolean }) => !o.locating)).toBe(true);

    const blocked = await post(owner, '/api/dispatch/routes/suggest', {
      orderIds: [orders[0]!.id],
    }).expect(400);
    expect(blocked.body.message).toBe(
      `Pedido ${orders[0]!.number} sem localização: marque no mapa`,
    );

    // Another unit sees nothing of this one.
    const foreign = (await get(bearer(other.accessToken), '/api/dispatch/board').expect(200)).body;
    expect(foreign.orders).toEqual([]);
    expect(foreign.couriers).toEqual([]);
  });

  it('pin: the operator places each order; saved in the cache and audited', async () => {
    for (const [i, km] of [3, 1, 2].entries()) {
      const res = await patch(
        owner,
        `/api/dispatch/orders/${orders[i]!.id}/location`,
        north(km),
      ).expect(200);
      expect(res.body.location).toMatchObject({
        ...north(km),
        source: 'MANUAL',
        precision: 'HOUSE',
      });
      expect(res.body.outsideArea).toBeNull();
    }
    await patch(waiter, `/api/dispatch/orders/${orders[0]!.id}/location`, north(3)).expect(403);
    await patch(owner, `/api/dispatch/orders/${orders[0]!.id}/location`, { latitude: 200 }).expect(
      400,
    );

    const cache = await ctx.prisma.geocodeCache.findMany({ where: { tenantId: store.storeId } });
    expect(cache.filter((c) => c.source === 'MANUAL')).toHaveLength(3);
    expect(
      await ctx.prisma.auditLog.count({
        where: { tenantId: store.storeId, action: 'delivery.location_corrected' },
      }),
    ).toBe(3);

    const board = (await get(owner, '/api/dispatch/board').expect(200)).body;
    expect(board.orders.find((o: Order) => o.id === orders[1]!.id).location).toMatchObject({
      ...north(1),
      source: 'MANUAL',
    });
  });

  it('suggest: nearest first (straight line without routing); a kept order stays', async () => {
    const all = orders.map((o) => o.id);
    const res = (await post(owner, '/api/dispatch/routes/suggest', { orderIds: all }).expect(200))
      .body;
    // 1 km, 2 km, 3 km.
    expect(res.orderIds).toEqual([orders[1]!.id, orders[2]!.id, orders[0]!.id]);
    expect(res).toMatchObject({ source: 'STRAIGHT', fallback: false });
    expect(res.legs).toHaveLength(3);
    expect(res.geometry).toHaveLength(4);
    expect(res.distanceMeters).toBeGreaterThan(3000);
    const etas = res.legs.map((l: { etaAt: string }) => Date.parse(l.etaAt));
    expect(etas).toEqual([...etas].sort((a, b) => a - b));

    const kept = (
      await post(owner, '/api/dispatch/routes/suggest', { orderIds: all, keepOrder: true }).expect(
        200,
      )
    ).body;
    expect(kept.orderIds).toEqual(all);
  });

  it('dispatch: stops in the chosen order, the run keeps its route', async () => {
    const chosen = [orders[1]!, orders[2]!, orders[0]!];
    await post(owner, '/api/dispatch/runs', {
      courierId: ids.moto,
      orders: chosen.map((o) => ({ orderId: o.id, expectedVersion: o.version })),
    }).expect(201);

    const board = (await get(owner, '/api/dispatch/board').expect(200)).body;
    expect(board.orders).toEqual([]);
    const run = board.couriers[0].run;
    expect(board.couriers[0].status).toBe('OUT');
    expect(run.stops.map((s: { orderId: string }) => s.orderId)).toEqual(chosen.map((o) => o.id));
    expect(run.stops.every((s: { etaAt: string | null }) => s.etaAt)).toBe(true);
    expect(run).toMatchObject({ routeSource: 'STRAIGHT', simulating: false, position: null });
    expect(run.geometry).toHaveLength(4);
    ids.run = run.id;
  });

  it('simulated courier: starts and stops on demand', async () => {
    await post(owner, '/api/dispatch/runs/nao-existe/simulate', { speed: 5 }).expect(404);
    await post(owner, `/api/dispatch/runs/${ids.run}/simulate`, { speed: 3 }).expect(400);
    await post(owner, `/api/dispatch/runs/${ids.run}/simulate`, { speed: 20 }).expect(204);
    expect(ctx.app.get(SimulationService).isWalking(ids.run!)).toBe(true);
    const board = (await get(owner, '/api/dispatch/board').expect(200)).body;
    expect(board.couriers[0].run.simulating).toBe(true);
    await ctx.http().delete(`/api/dispatch/runs/${ids.run}/simulate`).set(owner).expect(204);
    expect(ctx.app.get(SimulationService).isWalking(ids.run!)).toBe(false);
  });

  it('positions: kept for 7 days', async () => {
    const base = {
      tenantId: store.storeId,
      runId: ids.run!,
      courierId: ids.moto!,
      ...north(1),
      simulated: true,
    };
    const now = new Date();
    await ctx.prisma.courierPosition.createMany({
      data: [
        { ...base, recordedAt: new Date(now.getTime() - 8 * 86_400_000) },
        { ...base, recordedAt: new Date(now.getTime() - 60_000) },
      ],
    });
    expect(await ctx.app.get(PositionsService).cleanup(now)).toBe(1);
    const board = (await get(owner, '/api/dispatch/board').expect(200)).body;
    expect(board.couriers[0].run.position).toMatchObject({ ...north(1), simulated: true });
  });
});
