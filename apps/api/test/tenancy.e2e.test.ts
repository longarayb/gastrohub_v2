import { TenantContext } from '../src/core/tenancy/tenant-context.js';
import { DB, type Db } from '../src/core/tenancy/db.provider.js';
import {
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type RegisteredStore,
  type TestContext,
} from './utils.js';

describe('Multi-tenant isolation and RBAC (e2e)', () => {
  let ctx: TestContext;
  let storeA: RegisteredStore;
  let storeB: RegisteredStore;

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    storeA = await registerStore(ctx, { tradeName: 'Loja A' });
    storeB = await registerStore(ctx, { tradeName: 'Loja B' });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('each tenant only sees its own users', async () => {
    await ctx
      .http()
      .post('/api/users')
      .set(bearer(storeA.accessToken))
      .send({
        name: 'Garçom A',
        email: 'garcom.a@teste.com',
        role: 'WAITER',
        password: 'Senha1234',
      })
      .expect(201);

    const usersA = await ctx.http().get('/api/users').set(bearer(storeA.accessToken)).expect(200);
    const usersB = await ctx.http().get('/api/users').set(bearer(storeB.accessToken)).expect(200);

    expect(usersA.body.map((u: { email: string }) => u.email)).toContain('garcom.a@teste.com');
    expect(usersB.body.map((u: { email: string }) => u.email)).not.toContain('garcom.a@teste.com');
    expect(usersB.body).toHaveLength(1);
  });

  it('cannot update a user of another tenant', async () => {
    await ctx
      .http()
      .patch(`/api/users/${storeA.userId}`)
      .set(bearer(storeB.accessToken))
      .send({ name: 'Hacker' })
      .expect(404);
  });

  it('the scoped client refuses queries without tenant and injects tenantId', async () => {
    const db = ctx.app.get<Db>(DB);
    const tenant = ctx.app.get(TenantContext);

    await expect(db.businessHours.findMany()).rejects.toThrow(/Tenant context missing/);

    const hoursA = await tenant.run(storeA.storeId, () => db.businessHours.findMany());
    expect(hoursA.length).toBe(7);
    expect(hoursA.every((h) => h.tenantId === storeA.storeId)).toBe(true);

    const created = await tenant.run(storeB.storeId, () =>
      db.auditLog.create({ data: { action: 'test', entity: 'Test' } }),
    );
    expect(created.tenantId).toBe(storeB.storeId);

    await expect(
      tenant.run(storeB.storeId, () =>
        db.auditLog.create({ data: { tenantId: storeA.storeId, action: 'x', entity: 'X' } }),
      ),
    ).rejects.toThrow(/Cross-tenant/);
  });

  it('the database rejects inserts that bypass the extension', async () => {
    await expect(
      ctx.prisma.auditLog.create({ data: { action: 'bypass', entity: 'Test' } }),
    ).rejects.toThrow();
  });

  it('enforces role permissions', async () => {
    const login = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: 'garcom.a@teste.com', password: 'Senha1234' })
      .expect(200);
    expect(login.body.role).toBe('WAITER');

    await ctx.http().get('/api/users').set(bearer(login.body.accessToken)).expect(403);
    const forbidden = await ctx
      .http()
      .patch('/api/stores/current/settings')
      .set(bearer(login.body.accessToken))
      .send({})
      .expect(403);
    expect(forbidden.body.message).toBe('Você não tem permissão para esta ação');
  });

  it('managers cannot create owners', async () => {
    await ctx
      .http()
      .post('/api/users')
      .set(bearer(storeA.accessToken))
      .send({
        name: 'Gerente',
        email: 'gerente.a@teste.com',
        role: 'MANAGER',
        password: 'Senha1234',
      })
      .expect(201);
    const manager = await ctx
      .http()
      .post('/api/auth/login')
      .send({ email: 'gerente.a@teste.com', password: 'Senha1234' })
      .expect(200);
    await ctx
      .http()
      .post('/api/users')
      .set(bearer(manager.body.accessToken))
      .send({ name: 'Dono 2', email: 'dono2.a@teste.com', role: 'OWNER', password: 'Senha1234' })
      .expect(403);
  });

  it('keeps at least one active owner', async () => {
    await ctx
      .http()
      .patch(`/api/users/${storeA.userId}`)
      .set(bearer(storeA.accessToken))
      .send({ role: 'MANAGER' })
      .expect(400);
  });

  it('switches between stores the user has access to', async () => {
    // Owner of A creates a second unit and switches to it.
    const unit = await ctx
      .http()
      .post('/api/stores')
      .set(bearer(storeA.accessToken))
      .send({
        tradeName: 'Loja A - Centro',
        legalName: 'Loja A Centro LTDA',
        cnpj: '11444777000161',
        phone: '1133334444',
      })
      .expect(201);

    const switched = await ctx
      .http()
      .post('/api/auth/switch-store')
      .set(bearer(storeA.accessToken))
      .send({ storeId: unit.body.id })
      .expect(200);
    expect(switched.body.store.id).toBe(unit.body.id);
    expect(switched.body.memberships).toHaveLength(2);

    // Cannot switch to a store without membership.
    await ctx
      .http()
      .post('/api/auth/switch-store')
      .set(bearer(storeA.accessToken))
      .send({ storeId: storeB.storeId })
      .expect(403);
  });

  it('updates store data and opening hours', async () => {
    const hours = await ctx
      .http()
      .put('/api/stores/current/hours')
      .set(bearer(storeB.accessToken))
      .send({ hours: [{ weekday: 5, opensAt: '18:00', closesAt: '02:00' }] })
      .expect(200);
    expect(hours.body).toEqual([{ weekday: 5, opensAt: '18:00', closesAt: '02:00' }]);

    const settings = await ctx
      .http()
      .patch('/api/stores/current/settings')
      .set(bearer(storeB.accessToken))
      .send({
        serviceFeeBps: 1200,
        kdsLateAfterMinutes: 15,
        digitalMenuEnabled: true,
        deliveryMinimumCents: 2000,
        takeoutEtaMinutes: 25,
        autoAcceptDigitalOrders: false,
      })
      .expect(200);
    expect(settings.body.settings.serviceFeeBps).toBe(1200);

    const audit = await ctx.prisma.auditLog.findMany({ where: { tenantId: storeB.storeId } });
    expect(audit.some((a) => a.action === 'store.updated')).toBe(true);
  });
});
