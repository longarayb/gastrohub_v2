import { createTestApp, resetDatabase, type TestContext } from './utils.js';

describe('Rate limiting (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    process.env.THROTTLE_DISABLED = 'false';
  });

  afterAll(async () => {
    process.env.THROTTLE_DISABLED = 'true';
    await ctx.app.close();
  });

  it('blocks brute force on login after 10 attempts per minute', async () => {
    const attempt = () =>
      ctx.http().post('/api/auth/login').send({ email: 'alvo@teste.com', password: 'errada123' });

    for (let i = 0; i < 10; i++) {
      await attempt().expect(401);
    }
    const blocked = await attempt().expect(429);
    expect(blocked.body).toMatchObject({
      code: 'RATE_LIMITED',
      message: 'Muitas requisições. Aguarde um instante e tente novamente.',
    });
  });

  it('limits KDS pairing attempts per IP (10 per minute)', async () => {
    const attempt = () =>
      ctx.http().post('/api/kds-device/pair').send({ store: 'nao-existe', code: '123456' });
    for (let i = 0; i < 10; i++) {
      await attempt().expect(400);
    }
    await attempt().expect(429);
  });
});
