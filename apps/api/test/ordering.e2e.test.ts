import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

type Headers = { Authorization: string };

/**
 * Creation order survives a clock that goes back (D040): lists sort by the database sequence
 * (or the daily number), never by timestamps written with the application clock. The API runs
 * in this process, so moving `Date` back is moving the API clock back.
 */
describe('ordering with a clock that goes back (e2e)', () => {
  let ctx: TestContext;
  let store: RegisteredStore;
  let owner: Headers;
  const ids: Record<string, string> = {};

  const post = (url: string, body: object = {}) => ctx.http().post(url).set(owner).send(body);
  const get = (url: string) => ctx.http().get(url).set(owner);
  const clockBack = (minutes: number) => vi.setSystemTime(Date.now() - minutes * 60_000);

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    store = await registerStore(ctx, { tradeName: 'Relógio Teste' });
    owner = bearer(store.accessToken);
    ids.sector = (await post('/api/menu/sectors', { name: 'Cozinha' }).expect(201)).body.id;
    const category = await post('/api/menu/categories', { name: 'Lanches' }).expect(201);
    ids.fries = (
      await post('/api/menu/products', {
        categoryId: category.body.id,
        name: 'Batata',
        priceCents: 1500,
        sectorId: ids.sector,
      }).expect(201)
    ).body.id;
    ids.table = (await post('/api/tables', { name: '1' }).expect(201)).body[0].id;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('rounds, items, history and the board keep their order when the clock jumps back', async () => {
    const fries = { productId: ids.fries, quantity: 1 };
    const first = (
      await post('/api/orders', { type: 'DINE_IN', tableId: ids.table, items: [fries] }).expect(201)
    ).body;

    // The clock goes back 10 minutes (a VM resync, another API instance with a slow clock...).
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    clockBack(10);
    const second = (
      await post(`/api/orders/${first.id}/items`, {
        expectedVersion: first.version,
        items: [{ ...fries, quantity: 2 }],
        send: true,
      }).expect(201)
    ).body;
    // The second item really got an earlier timestamp (the jump happened).
    const stamped = await ctx.prisma.orderItem.findMany({
      where: { orderId: first.id },
      orderBy: { seq: 'asc' },
      select: { createdAt: true },
    });
    expect(stamped[1]!.createdAt.getTime()).toBeLessThan(stamped[0]!.createdAt.getTime());
    // Items in the order they were added, though the second has an earlier timestamp.
    expect(second.items.map((i: { roundNumber: number }) => i.roundNumber)).toEqual([1, 2]);

    // Kitchen: round 1 before round 2.
    const tickets = (await get(`/api/kds/board?sectors=${ids.sector}`).expect(200)).body.tickets;
    expect(tickets.map((t: { roundNumber: number }) => t.roundNumber)).toEqual([1, 2]);

    // Back again, then everything is ready: the last history entry is the latest change.
    clockBack(5);
    await post('/api/kds/tasks/ready', {
      taskIds: tickets.flatMap((t: { tasks: { id: string }[] }) => t.tasks.map((x) => x.id)),
    }).expect(204);
    const ready = (await get(`/api/orders/${first.id}`).expect(200)).body;
    expect(ready.status).toBe('READY');
    expect(ready.history.at(-1)).toMatchObject({ toStatus: 'READY' });

    // Board: the newest order (daily number) comes first, though created "earlier".
    const takeout = (await post('/api/orders', { type: 'TAKEOUT', items: [fries] }).expect(201))
      .body;
    expect(takeout.number).toBe(first.number + 1);
    const board = (await get('/api/orders?board=true').expect(200)).body as { id: string }[];
    expect(board.map((o) => o.id).indexOf(takeout.id)).toBeLessThan(
      board.map((o) => o.id).indexOf(first.id),
    );
  });
});
