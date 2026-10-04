import {
  createTestApp,
  refreshCookie,
  registerStore,
  resetDatabase,
  type TestContext,
} from './utils.js';

describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('registers a restaurant and returns an owner session with refresh cookie', async () => {
    const store = await registerStore(ctx, { tradeName: 'Pizzaria do João' });
    expect(store.accessToken).toBeTruthy();
    expect(store.cookie).toMatch(/^app_refresh=/);

    const me = await ctx
      .http()
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${store.accessToken}`)
      .expect(200);
    expect(me.body.role).toBe('OWNER');
    expect(me.body.store.slug).toBe('pizzaria-do-joao');
  });

  it('rejects duplicated e-mail on register', async () => {
    const store = await registerStore(ctx);
    const res = await ctx
      .http()
      .post('/api/auth/register')
      .send({
        ownerName: 'Outro',
        email: store.email,
        password: 'Senha1234',
        phone: '11987654321',
        tradeName: 'Outro',
        legalName: 'Outro LTDA',
        cnpj: '11222333000181',
      })
      .expect(409);
    expect(res.body.message).toBe('Já existe uma conta com este e-mail');
  });

  it('validates input with pt-BR messages', async () => {
    const res = await ctx
      .http()
      .post('/api/auth/register')
      .send({ ownerName: 'X', email: 'invalido', password: '123' })
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.details.length).toBeGreaterThan(0);
  });

  it('logs in and rejects wrong passwords', async () => {
    const store = await registerStore(ctx);
    await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: store.email, password: store.password })
      .expect(200);
    const bad = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: store.email, password: 'errada123' })
      .expect(401);
    expect(bad.body.message).toBe('E-mail ou senha inválidos');
  });

  it('requires authentication on protected routes', async () => {
    await ctx.http().get('/api/auth/me').expect(401);
    await ctx.http().get('/api/auth/me').set('Authorization', 'Bearer invalid').expect(401);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const store = await registerStore(ctx);

    const first = await ctx
      .http()
      .post('/api/auth/refresh')
      .set('Cookie', store.cookie)
      .expect(200);
    const rotated = refreshCookie(first.headers['set-cookie']);
    expect(rotated).not.toBe(store.cookie);

    // Reusing the old token is detected and kills the whole family...
    await ctx.http().post('/api/auth/refresh').set('Cookie', store.cookie).expect(401);
    // ...including the token issued by the legitimate rotation.
    await ctx.http().post('/api/auth/refresh').set('Cookie', rotated).expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const store = await registerStore(ctx);
    await ctx.http().post('/api/auth/logout').set('Cookie', store.cookie).expect(204);
    await ctx.http().post('/api/auth/refresh').set('Cookie', store.cookie).expect(401);
  });

  it('resets the password with the e-mailed token', async () => {
    const store = await registerStore(ctx);
    await ctx.http().post('/api/auth/forgot-password').send({ email: store.email }).expect(204);
    // Unknown e-mails get the same response (no account enumeration).
    await ctx
      .http()
      .post('/api/auth/forgot-password')
      .send({ email: 'ninguem@teste.com' })
      .expect(204);

    // The e-mail is sent asynchronously by the queue worker.
    await vi.waitFor(() => expect(ctx.mail.sent.some((m) => m.to === store.email)).toBe(true), {
      timeout: 10_000,
    });
    const mail = ctx.mail.sent.find((m) => m.to === store.email)!;
    const token = /token=([\w-]+)/.exec(mail.text)![1];

    await ctx
      .http()
      .post('/api/auth/reset-password')
      .send({ token, password: 'NovaSenha123', confirmPassword: 'NovaSenha123' })
      .expect(204);

    // Token is single use and old sessions are revoked.
    await ctx
      .http()
      .post('/api/auth/reset-password')
      .send({ token, password: 'NovaSenha123', confirmPassword: 'NovaSenha123' })
      .expect(400);
    await ctx.http().post('/api/auth/refresh').set('Cookie', store.cookie).expect(401);
    await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: store.email, password: 'NovaSenha123' })
      .expect(200);
  });
});
