import { STORE_PAIRING_FAILURE_LIMIT } from '../src/modules/kds/kds-devices.service.js';
import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

type Headers = { Authorization: string };
type Ticket = {
  key: string;
  orderId: string;
  roundNumber: number;
  sectorId: string;
  canceled: boolean;
  doneAt: string | null;
  tasks: {
    id: string;
    kind: string;
    name: string;
    quantity: number;
    status: string;
    recallCount: number;
    details: { removals: string[]; comboOf: string | null; modifiers: { name: string }[] };
  }[];
};

/** Kitchen display (D027) and KDS devices (D028). */
describe('KDS: production tasks, status, expedition and devices (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let owner: Headers;
  let kitchen: Headers;
  let waiter: Headers;
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

  const board = async (h: Headers, sector: string | undefined): Promise<Ticket[]> =>
    (await get(h, `/api/kds/board?sectors=${sector}`).expect(200)).body.tickets;
  const order = async (id: string | undefined) =>
    (await get(owner, `/api/orders/${id}`).expect(200)).body;
  const combo = (quantity = 1, notes?: string) => ({
    productId: ids.combo,
    quantity,
    notes,
    modifiers: [{ groupId: ids.drinkGroup, optionId: ids.drinkOption, quantity: 1 }],
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Cozinha Teste' });
    owner = bearer(store.accessToken);
    for (const [email, role] of [
      ['cozinha.kds@teste.com', 'KITCHEN'],
      ['garcom.kds@teste.com', 'WAITER'],
    ] as const) {
      await post(owner, '/api/users', { name: role, email, role, password: 'Senha1234' }).expect(
        201,
      );
    }
    kitchen = await login('cozinha.kds@teste.com');
    waiter = await login('garcom.kds@teste.com');

    ids.kitchenSector = (
      await post(owner, '/api/menu/sectors', { name: 'Cozinha' }).expect(201)
    ).body.id;
    ids.barSector = (
      await post(owner, '/api/menu/sectors', {
        name: 'Bar',
        warnAfterMinutes: 3,
        lateAfterMinutes: 6,
      }).expect(201)
    ).body.id;
    const category = await post(owner, '/api/menu/categories', { name: 'Lanches' }).expect(201);
    ids.guarana = (
      await post(owner, '/api/menu/products', {
        categoryId: category.body.id,
        name: 'Guaraná lata',
        priceCents: 600,
        sectorId: ids.barSector,
      }).expect(201)
    ).body.id;
    const drinks = await post(owner, '/api/menu/modifier-groups', {
      name: 'Bebida do combo',
      options: [{ productId: ids.guarana }],
    }).expect(201);
    ids.drinkGroup = drinks.body.id;
    ids.drinkOption = drinks.body.options[0].id;
    ids.combo = (
      await post(owner, '/api/menu/products', {
        categoryId: category.body.id,
        name: 'Combo Burger',
        priceCents: 3500,
        sectorId: ids.kitchenSector,
        modifierLinks: [{ groupId: ids.drinkGroup, minSelect: 1, maxSelect: 1 }],
      }).expect(201)
    ).body.id;
    ids.fries = (
      await post(owner, '/api/menu/products', {
        categoryId: category.body.id,
        name: 'Batata',
        priceCents: 1500,
        sectorId: ids.kitchenSector,
      }).expect(201)
    ).body.id;
    ids.table = (await post(owner, '/api/tables', { name: '1' }).expect(201)).body[0].id;
    ids.courier = (await post(owner, '/api/couriers', { name: 'Moto Teste' }).expect(201)).body.id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('routes a combo to two sectors and makes one ticket per round', async () => {
    const tab = (
      await post(waiter, '/api/orders', {
        type: 'DINE_IN',
        tableId: ids.table,
        items: [combo(2, 'sem cebola, bem passado')],
      }).expect(201)
    ).body;
    ids.tab = tab.id;
    await get(waiter, `/api/kds/board?sectors=${ids.kitchenSector}`).expect(403);

    const kitchenBoard = await board(kitchen, ids.kitchenSector);
    expect(kitchenBoard).toHaveLength(1);
    expect(kitchenBoard[0]!.tasks[0]).toMatchObject({
      kind: 'ITEM',
      name: 'Combo Burger',
      quantity: 2,
      status: 'QUEUED',
      details: { removals: ['sem cebola'] },
    });
    const barBoard = await board(kitchen, ids.barSector);
    expect(barBoard[0]!.tasks[0]).toMatchObject({
      kind: 'COMBO_PART',
      name: 'Guaraná lata',
      quantity: 2,
      details: { comboOf: 'Combo Burger' },
    });

    // Items added later are a new ticket, not mixed with the first one.
    await post(waiter, `/api/orders/${tab.id}/items`, {
      expectedVersion: tab.version,
      items: [{ productId: ids.fries, quantity: 1 }],
    }).expect(201);
    const tickets = await board(kitchen, ids.kitchenSector);
    expect(tickets.map((t) => t.roundNumber)).toEqual([1, 2]);
  });

  it('order status follows the tasks of every sector; a ready can be undone', async () => {
    const kitchenTasks = (await board(kitchen, ids.kitchenSector)).flatMap((t) => t.tasks);
    const barTask = (await board(kitchen, ids.barSector))[0]!.tasks[0]!;

    await post(kitchen, '/api/kds/tasks/start', { taskIds: [kitchenTasks[0]!.id] }).expect(204);
    expect((await order(ids.tab)).status).toBe('PREPARING');

    await post(kitchen, '/api/kds/tasks/ready', {
      taskIds: kitchenTasks.map((t) => t.id),
    }).expect(204);
    expect((await order(ids.tab)).status).toBe('PREPARING'); // the bar is not done
    await post(kitchen, '/api/kds/tasks/ready', { taskIds: [barTask.id] }).expect(204);
    const ready = await order(ids.tab);
    expect(ready.status).toBe('READY');
    expect(ready.items.every((i: { status: string }) => i.status === 'READY')).toBe(true);
    expect(ready.history.at(-1)).toMatchObject({ toStatus: 'READY' });

    await post(kitchen, `/api/kds/tasks/${barTask.id}/recall`).expect(204);
    expect((await order(ids.tab)).status).toBe('PREPARING');
    const recalled = (await board(kitchen, ids.barSector))[0]!.tasks[0]!;
    expect(recalled).toMatchObject({ status: 'PREPARING', recallCount: 1 });
    const audit = await ctx.prisma.auditLog.findFirst({
      where: { tenantId: store.storeId, action: 'kds.task_recalled' },
    });
    expect(audit).not.toBeNull();
    await post(kitchen, `/api/kds/tasks/${barTask.id}/recall`).expect(400);
    await post(kitchen, '/api/kds/tasks/ready', { taskIds: [barTask.id] }).expect(204);
    expect((await order(ids.tab)).status).toBe('READY');

    // Finished tickets stay in "Pronto (recentes)".
    const done = await board(kitchen, ids.barSector);
    expect(done[0]!.doneAt).not.toBeNull();
  });

  it('canceling an item or a whole order strikes its tasks in every sector', async () => {
    const o = (await post(owner, '/api/orders', { type: 'TAKEOUT', items: [combo(1)] }).expect(201))
      .body;
    await post(owner, `/api/orders/${o.id}/status`, {
      expectedVersion: o.version,
      status: 'CANCELED',
      reason: 'Cliente desistiu',
    }).expect(200);
    for (const sector of [ids.kitchenSector, ids.barSector]) {
      const ticket = (await board(kitchen, sector!)).find((t) => t.orderId === o.id)!;
      expect(ticket.canceled).toBe(true);
      expect(ticket.tasks.every((t) => t.status === 'CANCELED')).toBe(true);
    }
    await post(kitchen, '/api/kds/tasks/start', {
      taskIds: [
        (await board(kitchen, ids.barSector)).find((t) => t.orderId === o.id)!.tasks[0]!.id,
      ],
    }).expect(400);
  });

  it('expedition: serve a takeout round, dispatch a delivery with a courier', async () => {
    const takeout = (
      await post(owner, '/api/orders', {
        type: 'TAKEOUT',
        items: [{ productId: ids.fries, quantity: 1 }],
      }).expect(201)
    ).body;
    const ticket = (await board(kitchen, ids.kitchenSector)).find((t) => t.orderId === takeout.id)!;
    await post(kitchen, `/api/kds/orders/${takeout.id}/serve`, {
      roundIds: [ticket.key.split(':')[0]],
    }).expect(400);
    await post(kitchen, '/api/kds/tasks/ready', { taskIds: ticket.tasks.map((t) => t.id) }).expect(
      204,
    );
    const exp = (await get(kitchen, '/api/kds/expedition').expect(200)).body;
    const row = exp.orders.find((x: { orderId: string }) => x.orderId === takeout.id);
    expect(row).toMatchObject({ complete: true, status: 'READY' });
    await post(kitchen, `/api/kds/orders/${takeout.id}/serve`, {
      roundIds: [row.rounds[0].roundId],
    }).expect(204);
    const served = await order(takeout.id);
    expect(served.status).toBe('READY'); // closing still needs the payment
    expect(served.items[0].status).toBe('SERVED');
    const after = (await get(kitchen, '/api/kds/expedition').expect(200)).body;
    expect(after.orders.some((x: { orderId: string }) => x.orderId === takeout.id)).toBe(false);

    const delivery = (
      await post(owner, '/api/orders', {
        type: 'DELIVERY',
        customer: { name: 'Ana', phone: '(11) 98888-1111' },
        deliveryAddress: {
          cep: '01310100',
          street: 'Avenida Paulista',
          number: '10',
          neighborhood: 'Bela Vista',
          city: 'São Paulo',
          state: 'SP',
        },
        items: [{ productId: ids.fries, quantity: 2 }],
      }).expect(201)
    ).body;
    const dTicket = (await board(kitchen, ids.kitchenSector)).find(
      (t) => t.orderId === delivery.id,
    )!;
    await post(kitchen, '/api/kds/tasks/ready', { taskIds: dTicket.tasks.map((t) => t.id) }).expect(
      204,
    );
    const readyDelivery = await order(delivery.id);
    await post(kitchen, `/api/kds/orders/${delivery.id}/dispatch`, {
      expectedVersion: readyDelivery.version - 1,
      courierId: ids.courier,
    }).expect(409);
    await post(kitchen, `/api/kds/orders/${delivery.id}/dispatch`, {
      expectedVersion: readyDelivery.version,
      courierId: ids.courier,
    }).expect(204);
    expect(await order(delivery.id)).toMatchObject({
      status: 'DISPATCHED',
      courierId: ids.courier,
    });
  });

  it('moving part of a line to another tab moves its tasks', async () => {
    const tab = await order(ids.tab);
    const comboItem = tab.items.find((i: { name: string }) => i.name === 'Combo Burger');
    const moved = (
      await post(owner, `/api/orders/${tab.id}/move-items`, {
        expectedVersion: tab.version,
        items: [{ itemId: comboItem.id, quantity: 1 }],
        newTabLabel: 'Bia',
      }).expect(200)
    ).body;
    const bar = await board(kitchen, ids.barSector);
    const quantities = bar
      .filter((t) => [moved.source.id, moved.target.id].includes(t.orderId))
      .map((t) => t.tasks[0]!.quantity)
      .sort();
    expect(quantities).toEqual([1, 1]);
  });

  it('sector limits are validated and products can be marked sold out', async () => {
    await ctx
      .http()
      .patch(`/api/menu/sectors/${ids.barSector}`)
      .set(owner)
      .send({ name: 'Bar', warnAfterMinutes: 5, lateAfterMinutes: 5 })
      .expect(400);
    const sectors = (await get(kitchen, '/api/kds/sectors').expect(200)).body;
    expect(sectors.find((s: { id: string }) => s.id === ids.barSector)).toMatchObject({
      warnAfterMinutes: 3,
      lateAfterMinutes: 6,
    });
    const products = (await get(kitchen, `/api/kds/products?sectors=${ids.barSector}`).expect(200))
      .body;
    expect(products.map((p: { name: string }) => p.name)).toEqual(['Guaraná lata']);
  });

  describe('devices', () => {
    let code: string;
    let deviceId: string;
    let cookie: string;
    let token: Headers;

    const pair = (body: object) => ctx.http().post('/api/kds-device/pair').send(body);
    const cookieOf = (res: { headers: Record<string, unknown> }) => {
      const list = res.headers['set-cookie'] as string[] | undefined;
      return (list ?? []).find((c) => c.startsWith('app_device='))?.split(';')[0] ?? '';
    };

    it('managers create a screen and get a 6-digit code', async () => {
      await post(kitchen, '/api/kds/devices', {
        name: 'Tablet',
        sectorIds: [ids.barSector],
      }).expect(403);
      await post(owner, '/api/kds/devices', { name: 'Vazio', sectorIds: [] }).expect(400);
      const created = (
        await post(owner, '/api/kds/devices', {
          name: 'Tablet do bar',
          sectorIds: [ids.barSector],
        }).expect(201)
      ).body;
      expect(created.code).toMatch(/^\d{6}$/);
      expect(created).toMatchObject({
        storeSlug: expect.any(String),
        device: { state: 'PENDING' },
      });
      code = created.code;
      deviceId = created.device.id;
      ids.slug = created.storeSlug;
    });

    it('wrong codes count per code: 5 failures invalidate it (audited)', async () => {
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        const res = await pair({ store: ids.slug, code: wrong }).expect(400);
        expect(res.body.message).toMatch(/Código inválido ou expirado/);
      }
      await pair({ store: ids.slug, code }).expect(400); // invalidated
      const failures = await ctx.prisma.auditLog.count({
        where: { tenantId: store.storeId, action: 'kds.pairing_failed' },
      });
      // 5 wrong codes + the invalidated one; an unknown store is not counted anywhere.
      expect(failures).toBe(6);
      await pair({ store: 'loja-inexistente', code }).expect(400);
    });

    it('pairs with a new code: cookie, device token limited to the KDS', async () => {
      code = (await post(owner, `/api/kds/devices/${deviceId}/pairing-code`).expect(201)).body.code;
      const res = await pair({ store: ids.slug, code }).expect(200);
      cookie = cookieOf(res);
      expect(cookie).toMatch(/^app_device=/);
      expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/);
      expect(res.body.device).toMatchObject({ id: deviceId, sectorIds: [ids.barSector] });
      token = bearer(res.body.accessToken);
      await pair({ store: ids.slug, code }).expect(400); // single use

      await get(token, `/api/kds/board?sectors=${ids.barSector}`).expect(200);
      await get(token, `/api/kds/board?sectors=${ids.kitchenSector}`).expect(403);
      await get(token, '/api/kds/expedition').expect(403);
      await get(token, '/api/orders').expect(403);
      await get(token, '/api/stores/current').expect(403);
      await post(token, `/api/menu/products/${ids.guarana}/pause`, { mode: 'END_OF_DAY' }).expect(
        200,
      );
      await post(token, `/api/menu/products/${ids.guarana}/resume`).expect(200);

      const device = (await get(owner, '/api/kds/devices').expect(200)).body[0];
      expect(device).toMatchObject({ state: 'PAIRED' });
    });

    it('renews the session with the cookie (rotated) and is revoked right away', async () => {
      const renewed = await ctx
        .http()
        .post('/api/kds-device/session')
        .set('Cookie', cookie)
        .expect(200);
      const next = cookieOf(renewed);
      expect(next).not.toBe(cookie);
      await ctx.http().post('/api/kds-device/session').set('Cookie', cookie).expect(401); // old one
      token = bearer(renewed.body.accessToken);

      await post(owner, `/api/kds/devices/${deviceId}/revoke`).expect(200);
      await get(token, `/api/kds/board?sectors=${ids.barSector}`).expect(401);
      await ctx.http().post('/api/kds-device/session').set('Cookie', next).expect(401);
    });

    it('blocks pairing in a store after too many failures', async () => {
      const fresh = (
        await post(owner, '/api/kds/devices', {
          name: 'Outra',
          sectorIds: [ids.kitchenSector],
        }).expect(201)
      ).body;
      const recorded = await ctx.prisma.auditLog.count({
        where: { tenantId: store.storeId, action: 'kds.pairing_failed' },
      });
      for (let i = recorded; i < STORE_PAIRING_FAILURE_LIMIT; i++) {
        await pair({ store: ids.slug, code: fresh.code === '999999' ? '888888' : '999999' }).expect(
          400,
        );
      }
      const blocked = await pair({ store: ids.slug, code: fresh.code }).expect(429);
      expect(blocked.body.code).toBe('RATE_LIMITED');
    });
  });
});
