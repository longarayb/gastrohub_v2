import { DEMO_MODE_MESSAGE } from '@app/shared';
import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

type Headers = { Authorization: string };

/** Public demo unit (D045): the API refuses the sensitive actions; selling stays open. */
describe('Demo mode (e2e)', () => {
  let ctx: TestContext;
  let demo: RegisteredStore;
  let normal: RegisteredStore;
  let owner: Headers;
  let slug: string;
  const ids: Record<string, string> = {};

  const send = (method: 'post' | 'patch' | 'put' | 'delete', url: string, body: object = {}) =>
    ctx.http()[method](url).set(owner).send(body);
  const refused = (res: { status: number; body: { code?: string; message?: string } }) => {
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DEMO_MODE');
    expect(res.body.message).toBe(DEMO_MODE_MESSAGE);
  };
  const notRefused = (res: { body: { code?: string } }) =>
    expect(res.body.code).not.toBe('DEMO_MODE');

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    demo = await registerStore(ctx, { tradeName: 'Demo Pública' });
    normal = await registerStore(ctx, { tradeName: 'Restaurante Normal' });
    owner = bearer(demo.accessToken);
    slug = (await ctx.prisma.store.findUniqueOrThrow({ where: { id: demo.storeId } })).slug;

    // Catalog created before the demo mode is turned on (deleting it is what gets refused).
    const category = await send('post', '/api/menu/categories', { name: 'Lanches' }).expect(201);
    ids.category = category.body.id;
    const product = await send('post', '/api/menu/products', {
      categoryId: ids.category,
      name: 'X-Demo',
      priceCents: 2500,
    }).expect(201);
    ids.product = product.body.id;

    await ctx.prisma.store.update({ where: { id: demo.storeId }, data: { demoMode: true } });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('shows the demo banner and never asks the visitors to accept the terms', async () => {
    const res = await ctx.http().get('/api/stores/current/notices').set(owner).expect(200);
    expect(res.body.demoMode).toBe(true);
    expect(res.body.termsRequired).toBeNull();
    refused(await send('post', '/api/stores/current/terms', {}));
  });

  it('refuses users, password, company, PIX, logo and hours', async () => {
    refused(
      await send('post', '/api/users', {
        name: 'Intruso',
        email: 'intruso@teste.com',
        role: 'MANAGER',
        password: 'Senha1234',
      }),
    );
    refused(await send('patch', `/api/users/${demo.userId}`, { name: 'Outro' }));
    refused(
      await send('post', '/api/auth/change-password', {
        currentPassword: demo.password,
        newPassword: 'Outra1234',
      }),
    );
    refused(await send('patch', '/api/stores/current', { tradeName: 'Mudado' }));
    refused(await send('patch', '/api/stores/current/settings', { takeoutEtaMinutes: 5 }));
    refused(await send('patch', '/api/stores/current/pix', { pixKey: 'golpe@teste.com' }));
    refused(await send('post', '/api/stores/current/logo'));
    refused(await send('put', '/api/stores/current/hours', { hours: [] }));
    refused(await send('post', '/api/stores', { tradeName: 'Outra unidade' }));
  });

  it('refuses printing setup, deletions and image uploads', async () => {
    refused(await send('post', '/api/printing/agents', { name: 'Computador' }));
    refused(await send('post', '/api/printing/printers', { name: 'Térmica' }));
    refused(await send('put', '/api/printing/settings', {}));
    refused(await send('delete', `/api/menu/products/${ids.product}`));
    refused(await send('delete', `/api/menu/categories/${ids.category}`));
    refused(await send('post', `/api/menu/products/${ids.product}/image`));
    refused(await send('post', '/api/digital-menu/cover'));
    refused(await send('put', '/api/digital-menu/settings', {}));
    // Nothing was deleted or changed.
    expect(await ctx.prisma.product.count({ where: { id: ids.product } })).toBe(1);
    const store = await ctx.prisma.store.findUniqueOrThrow({ where: { id: demo.storeId } });
    expect(store.tradeName).toBe('Demo Pública');
    expect(store.pixKey).toBeNull();
  });

  it('refuses real orders from the digital menu (the preview still works)', async () => {
    notRefused(
      await ctx
        .http()
        .post(`/api/public/${slug}/cart`)
        .send({ type: 'TAKEOUT', items: [{ productId: ids.product, quantity: 1 }] }),
    );
    refused(
      await ctx
        .http()
        .post(`/api/public/${slug}/orders`)
        .send({ type: 'TAKEOUT', items: [{ productId: ids.product, quantity: 1 }] }),
    );
  });

  it('keeps selling open: catalog edits, orders and removing an unsent item', async () => {
    notRefused(await send('patch', `/api/menu/products/${ids.product}`, { priceCents: 2600 }));
    const order = await send('post', '/api/orders', {
      type: 'TAKEOUT',
      items: [{ productId: ids.product, quantity: 2 }],
    }).expect(201);
    const itemId = order.body.items[0].id as string;
    notRefused(
      await send('delete', `/api/orders/${order.body.id}/items/${itemId}`, {
        expectedVersion: order.body.version,
      }),
    );
  });

  /** Waits for the e-mail queue: true when a message to `to` arrives within `ms`. */
  async function mailArrives(to: string, ms = 3000): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (ctx.mail.sent.some((m) => m.to === to)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  it('sends no password e-mail to demo users (same answer); other users still get it', async () => {
    await ctx.http().post('/api/auth/forgot-password').send({ email: demo.email }).expect(204);
    await ctx.http().post('/api/auth/forgot-password').send({ email: normal.email }).expect(204);
    // The normal one arrives through the same queue: by then the demo one would have, too.
    expect(await mailArrives(normal.email)).toBe(true);
    expect(ctx.mail.sent.some((m) => m.to === demo.email)).toBe(false);
  });

  it('does not affect other units', async () => {
    const other = bearer(normal.accessToken);
    const res = await ctx.http().post('/api/users').set(other).send({
      name: 'Caixa Normal',
      email: 'caixa.normal@teste.com',
      role: 'CASHIER',
      password: 'Senha1234',
    });
    notRefused(res);
    expect(res.status).toBe(201);
    const notices = await ctx.http().get('/api/stores/current/notices').set(other).expect(200);
    expect(notices.body.demoMode).toBe(false);
  });
});
