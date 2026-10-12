import { addDaysToDate, billingDate } from '@app/shared';
import { PlatformAuthService } from '../src/modules/platform/platform-auth.service.js';
import { PLATFORM_REFRESH_COOKIE } from '../src/modules/platform/platform.controller.js';
import { totp } from '../src/modules/platform/security/two-factor.js';
import {
  TEST_PLAN_ID,
  bearer,
  createTestApp,
  registerStore,
  resetDatabase,
  type TestContext,
} from './utils.js';

const ACTOR = { adminId: null, ip: null, userAgent: 'e2e' };
const ADMIN = { email: 'admin@plataforma.test', name: 'Admin Teste', password: 'SenhaForte123' };

function cookieOf(setCookie: string | string[] | undefined, name: string): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return list.find((c) => c.startsWith(`${name}=`))?.split(';')[0] ?? '';
}

describe('Platform admin (e2e)', () => {
  let ctx: TestContext;
  let adminToken: string;
  let adminCookie: string;
  let totpSecret: string;
  let recoveryCodes: string[];

  const admin = (method: 'get' | 'post' | 'put', path: string, body?: object) => {
    const req = ctx.http()[method](`/api/platform${path}`).set(bearer(adminToken));
    return body ? req.send(body) : req;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await resetDatabase(ctx.prisma);
    await ctx.app.get(PlatformAuthService).createAdmin(ADMIN, ACTOR);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe('authentication', () => {
    it('enrolls the authenticator on the first access and shows the recovery codes once', async () => {
      const login = await ctx
        .http()
        .post('/api/platform/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200);
      expect(login.body.step).toBe('ENROLL');

      const enroll = await ctx
        .http()
        .post('/api/platform/auth/2fa/enroll/start')
        .send({ challenge: login.body.challenge })
        .expect(200);
      expect(enroll.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      totpSecret = enroll.body.secret;

      await ctx
        .http()
        .post('/api/platform/auth/2fa/enroll/confirm')
        .send({ challenge: login.body.challenge, code: '000000' })
        .expect(401);
      const confirmed = await ctx
        .http()
        .post('/api/platform/auth/2fa/enroll/confirm')
        .send({ challenge: login.body.challenge, code: totp(totpSecret) })
        .expect(200);
      expect(confirmed.body.recoveryCodes).toHaveLength(10);
      expect(confirmed.body.admin.totpEnabled).toBe(true);
      recoveryCodes = confirmed.body.recoveryCodes;
      adminToken = confirmed.body.accessToken;
      adminCookie = cookieOf(confirmed.headers['set-cookie'], PLATFORM_REFRESH_COOKIE);
      expect(adminCookie).not.toBe('');

      const me = await admin('get', '/auth/me').expect(200);
      expect(me.body).toMatchObject({ email: ADMIN.email, recoveryCodesLeft: 10 });
    });

    it('never accepts a password alone, nor the same code twice', async () => {
      const login = await ctx
        .http()
        .post('/api/platform/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200);
      expect(login.body).toEqual({ step: 'TOTP', challenge: expect.any(String) });
      // The code used to enroll was already consumed.
      await ctx
        .http()
        .post('/api/platform/auth/2fa/verify')
        .send({ challenge: login.body.challenge, code: totp(totpSecret) })
        .expect(401);
      // The next window's code is still accepted (clock drift tolerance).
      const next = totp(totpSecret, new Date(Date.now() + 30_000));
      await ctx
        .http()
        .post('/api/platform/auth/2fa/verify')
        .send({ challenge: login.body.challenge, code: next })
        .expect(200);
      await ctx
        .http()
        .post('/api/platform/auth/2fa/verify')
        .send({ challenge: login.body.challenge, code: next })
        .expect(401);
    });

    it('accepts each recovery code only once', async () => {
      const login = await ctx
        .http()
        .post('/api/platform/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(200);
      const code = recoveryCodes[0]!.toLowerCase().replace('-', ' ');
      await ctx
        .http()
        .post('/api/platform/auth/2fa/recover')
        .send({ challenge: login.body.challenge, recoveryCode: code })
        .expect(200);
      await ctx
        .http()
        .post('/api/platform/auth/2fa/recover')
        .send({ challenge: login.body.challenge, recoveryCode: code })
        .expect(401);
      const me = await admin('get', '/auth/me').expect(200);
      expect(me.body.recoveryCodesLeft).toBe(9);
    });

    it('rotates the refresh cookie and keeps restaurant and platform tokens apart', async () => {
      const refreshed = await ctx
        .http()
        .post('/api/platform/auth/refresh')
        .set('Cookie', adminCookie)
        .expect(200);
      const rotated = cookieOf(refreshed.headers['set-cookie'], PLATFORM_REFRESH_COOKIE);
      expect(rotated).not.toBe(adminCookie);
      await ctx.http().post('/api/platform/auth/refresh').set('Cookie', adminCookie).expect(401);
      adminCookie = rotated;
      adminToken = refreshed.body.accessToken;

      const store = await registerStore(ctx, { tradeName: 'Loja curiosa' });
      await ctx.http().get('/api/platform/overview').set(bearer(store.accessToken)).expect(401);
      await ctx.http().get('/api/platform/overview').expect(401);
      await ctx.http().get('/api/orders').set(bearer(adminToken)).expect(401);
    });

    it('locks the account after repeated failures', async () => {
      const other = { email: 'outro@plataforma.test', name: 'Outro', password: 'SenhaForte123' };
      await ctx.app.get(PlatformAuthService).createAdmin(other, ACTOR);
      for (let i = 0; i < 5; i++) {
        await ctx
          .http()
          .post('/api/platform/auth/login')
          .send({ email: other.email, password: 'errada' })
          .expect(401);
      }
      const locked = await ctx
        .http()
        .post('/api/platform/auth/login')
        .send({ email: other.email, password: other.password })
        .expect(429);
      expect(locked.body.message).toMatch(/bloqueado/);
    });

    it('keeps the platform audit append-only', async () => {
      const count = await ctx.prisma.platformAuditLog.count();
      expect(count).toBeGreaterThan(5);
      await expect(
        ctx.prisma.platformAuditLog.updateMany({ data: { action: 'x' } }),
      ).rejects.toThrow(/append-only/);
      await expect(ctx.prisma.platformAuditLog.deleteMany({})).rejects.toThrow(/append-only/);
      const actions = (
        await ctx.prisma.platformAuditLog.findMany({ select: { action: true } })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'admin.created',
          'auth.totp_enrolled',
          'auth.login',
          'auth.totp_failed',
          'auth.recovery_code_used',
          'auth.password_failed',
          'auth.locked',
        ]),
      );
    });

    it('resets the 2FA in an emergency (server command) and audits it', async () => {
      await ctx.app
        .get(PlatformAuthService)
        .resetTwoFactor('outro@plataforma.test', 'Celular perdido', {
          ...ACTOR,
          email: 'cli:teste',
        });
      const reset = await ctx.prisma.platformAuditLog.findFirst({
        where: { action: 'auth.totp_reset_emergency' },
      });
      expect(reset).toMatchObject({ actorEmail: 'cli:teste', reason: 'Celular perdido' });
    });
  });

  describe('admin password', () => {
    it('changes the password with the current one and keeps this session', async () => {
      await admin('post', '/auth/password', {
        currentPassword: 'errada',
        newPassword: 'NovaSenha123',
        confirmPassword: 'NovaSenha123',
      }).expect(400);
      await admin('post', '/auth/password', {
        currentPassword: ADMIN.password,
        newPassword: 'NovaSenha123',
        confirmPassword: 'NovaSenha123',
      }).expect(204);
      await admin('get', '/auth/me').expect(200);
      const login = await ctx
        .http()
        .post('/api/platform/auth/login')
        .send({ email: ADMIN.email, password: 'NovaSenha123' })
        .expect(200);
      expect(login.body.step).toBe('TOTP');
      expect(
        await ctx.prisma.platformAuditLog.count({ where: { action: 'auth.password_changed' } }),
      ).toBe(1);
    });
  });

  describe('customers, invoices and read-only mode', () => {
    let customerId: string;
    let storeId: string;
    let ownerToken: string;
    let essentialPlanId: string;

    const customerPayload = (email: string, overrides: object = {}) => ({
      customer: {
        name: 'Cantina do Teste',
        document: '11222333000181',
        legalName: 'Cantina do Teste LTDA',
        invoiceEmail: 'financeiro@cantina.test',
        contactName: 'Maria',
        contactPhone: '11987654321',
        address: {
          cep: '01310100',
          street: 'Av. Paulista',
          number: '1000',
          neighborhood: 'Bela Vista',
          city: 'São Paulo',
          state: 'SP',
        },
      },
      store: { tradeName: 'Cantina do Teste', cnpj: '11222333000181', phone: '11987654321' },
      owner: { name: 'Maria Dona', email },
      ...overrides,
    });

    it('creates plans', async () => {
      const plan = await admin('post', '/plans', {
        name: 'Essencial',
        priceCents: 14_900,
        interval: 'MONTHLY',
        trialDays: 0,
        storeLimit: 1,
        extraStorePriceCents: null,
        modules: ['KDS'],
      }).expect(201);
      essentialPlanId = plan.body.id;
      await admin('post', '/plans', {
        name: 'Essencial',
        priceCents: 1,
        interval: 'MONTHLY',
        storeLimit: 1,
      }).expect(409);
    });

    it('creates the customer, the first store and the owner, and e-mails the invitation', async () => {
      const startDate = addDaysToDate(billingDate(new Date()), -30);
      const res = await admin(
        'post',
        '/customers',
        customerPayload('maria@cantina.test', {
          subscription: { planId: essentialPlanId, startDate },
        }),
      ).expect(201);
      customerId = res.body.id;
      storeId = res.body.stores[0].id;
      expect(res.body.users[0]).toMatchObject({ email: 'maria@cantina.test', invitePending: true });
      expect(res.body.subscription).toMatchObject({ billingStart: startDate, trialEndsOn: null });

      // Not able to sign in before accepting the invitation.
      await ctx
        .http()
        .post('/api/auth/login')
        .send({ email: 'maria@cantina.test', password: 'qualquer1' })
        .expect(401);

      await vi.waitFor(() =>
        expect(ctx.mail.sent.some((m) => m.to === 'maria@cantina.test')).toBe(true),
      );
      const mail = ctx.mail.sent.find((m) => m.to === 'maria@cantina.test')!;
      const token = /convite\?token=([\w-]+)/.exec(mail.text)![1];
      const accepted = await ctx
        .http()
        .post('/api/auth/accept-invite')
        .send({ token, password: 'SenhaDaMaria1', confirmPassword: 'SenhaDaMaria1' })
        .expect(200);
      ownerToken = accepted.body.accessToken;
      expect(accepted.body.store.id).toBe(storeId);
      await ctx
        .http()
        .post('/api/auth/accept-invite')
        .send({ token, password: 'SenhaDaMaria1', confirmPassword: 'SenhaDaMaria1' })
        .expect(400);
    });

    it('asks the owner to accept the terms and records version and IP', async () => {
      const before = await ctx
        .http()
        .get('/api/stores/current/notices')
        .set(bearer(ownerToken))
        .expect(200);
      expect(before.body.termsRequired).not.toBeNull();
      await ctx
        .http()
        .post('/api/stores/current/terms')
        .set(bearer(ownerToken))
        .send({ termsVersion: 'velha', privacyVersion: before.body.termsRequired.privacyVersion })
        .expect(400);
      await ctx
        .http()
        .post('/api/stores/current/terms')
        .set(bearer(ownerToken))
        .send(before.body.termsRequired)
        .expect(204);
      const after = await ctx
        .http()
        .get('/api/stores/current/notices')
        .set(bearer(ownerToken))
        .expect(200);
      expect(after.body.termsRequired).toBeNull();
      const detail = await admin('get', `/customers/${customerId}`).expect(200);
      expect(detail.body.terms).toMatchObject({
        current: true,
        userName: 'Maria Dona',
        ip: expect.any(String),
      });
    });

    it('blocks only new sales in read-only mode, and unblocks right away on payment', async () => {
      // Started 30 days ago without trial, first invoice unpaid: grace (7 days) is long over and
      // the store (open 11:00–23:00) is read-only since the first night after it.
      const notices = await ctx
        .http()
        .get('/api/stores/current/notices')
        .set(bearer(ownerToken))
        .expect(200);
      expect(notices.body.billing).toMatchObject({
        level: 'READ_ONLY',
        readOnly: true,
        amountCents: 14_900,
      });

      const blocked = await ctx
        .http()
        .post('/api/orders')
        .set(bearer(ownerToken))
        .send({})
        .expect(403);
      expect(blocked.body.code).toBe('READ_ONLY_MODE');
      await ctx
        .http()
        .post('/api/cash-sessions')
        .set(bearer(ownerToken))
        .send({ openingCents: 0 })
        .expect(403);
      // Reading and reports keep working.
      await ctx.http().get('/api/orders').set(bearer(ownerToken)).expect(200);
      await ctx.http().get('/api/stores/current').set(bearer(ownerToken)).expect(200);

      const list = await admin('get', '/customers').expect(200);
      expect(list.body.find((c: { id: string }) => c.id === customerId)).toMatchObject({
        status: 'SUSPENDED',
        daysOverdue: 30,
      });

      // Generating twice creates the invoices once.
      const first = await admin('post', '/invoices/generate', {
        organizationId: customerId,
      }).expect(200);
      expect(first.body.created).toBeGreaterThanOrEqual(2);
      const again = await admin('post', '/invoices/generate', {
        organizationId: customerId,
      }).expect(200);
      expect(again.body.created).toBe(0);

      const open = await admin('get', `/invoices?organizationId=${customerId}&status=OPEN`).expect(
        200,
      );
      expect(open.body.every((i: { amountCents: number }) => i.amountCents === 14_900)).toBe(true);
      for (const invoice of open.body as { id: string; version: number }[]) {
        await admin('post', `/invoices/${invoice.id}/pay`, {
          expectedVersion: invoice.version,
          paidOn: billingDate(new Date()),
          paymentMethod: 'PIX',
          note: 'Comprovante no WhatsApp',
        }).expect(200);
      }
      // Paying again is refused (already paid).
      await admin('post', `/invoices/${open.body[0].id}/pay`, {
        expectedVersion: open.body[0].version,
        paidOn: billingDate(new Date()),
        paymentMethod: 'PIX',
      }).expect(400);

      // Unblocked immediately: the order route now reaches validation (400), not the block.
      await ctx.http().post('/api/orders').set(bearer(ownerToken)).send({}).expect(400);
      const ok = await ctx
        .http()
        .get('/api/stores/current/notices')
        .set(bearer(ownerToken))
        .expect(200);
      expect(ok.body.billing.readOnly).toBe(false);
    });

    it('enforces plan modules and the store limit, and records plan changes', async () => {
      await ctx.http().get('/api/digital-menu/settings').set(bearer(ownerToken)).expect(403);
      await ctx.http().get('/api/kds/devices').set(bearer(ownerToken)).expect(200);
      const unit = {
        tradeName: 'Filial',
        legalName: 'Filial LTDA',
        cnpj: '11444777000161',
        phone: '11987654321',
      };
      const limited = await ctx
        .http()
        .post('/api/stores')
        .set(bearer(ownerToken))
        .send(unit)
        .expect(403);
      expect(limited.body.code).toBe('PLAN_LIMIT');

      const detail = await admin('get', `/customers/${customerId}`).expect(200);
      await admin('post', `/customers/${customerId}/subscription/plan`, {
        expectedVersion: detail.body.subscription.version,
        planId: TEST_PLAN_ID,
        reason: 'Cliente quer o cardápio digital',
      }).expect(200);
      await admin('post', `/customers/${customerId}/subscription/plan`, {
        expectedVersion: detail.body.subscription.version,
        planId: essentialPlanId,
        reason: 'Versão antiga',
      }).expect(409);

      await ctx.http().get('/api/digital-menu/settings').set(bearer(ownerToken)).expect(200);
      const created = await ctx
        .http()
        .post('/api/stores')
        .set(bearer(ownerToken))
        .send(unit)
        .expect(201);
      expect(created.body.id).toBeTruthy();

      const after = await admin('get', `/customers/${customerId}`).expect(200);
      expect(after.body.subscription.changes[0]).toMatchObject({
        kind: 'PLAN_CHANGED',
        fromPlanName: 'Essencial',
        toPlanName: 'Plano de testes',
        reason: 'Cliente quer o cardápio digital',
        adminName: ADMIN.name,
      });
    });

    it('schedules a manual suspension for the end of the business day', async () => {
      const detail = await admin('get', `/customers/${customerId}`).expect(200);
      const res = await admin('post', `/customers/${customerId}/subscription/suspend`, {
        expectedVersion: detail.body.subscription.version,
        reason: 'Teste de suspensão',
      }).expect(200);
      expect(res.body.subscription.readOnlyReason).toBe('SUSPENDED');
      const store = res.body.stores.find((s: { id: string }) => s.id === storeId);
      expect(store.readOnlyFrom).not.toBeNull();
      await admin('post', `/customers/${customerId}/subscription/reactivate`, {
        expectedVersion: res.body.subscription.version,
        reason: 'Fim do teste',
      }).expect(200);
    });

    describe('support sessions', () => {
      let supportToken: string;
      let sessionId: string;

      it('requires an explicit confirmation to allow changes', async () => {
        await admin('post', '/support-sessions', {
          storeId,
          reason: 'Cliente pediu ajuda com o cardápio',
          minutes: 30,
          mode: 'READ_WRITE',
        }).expect(400);
      });

      it('opens a read-only session with a banner, an e-mail and both audits', async () => {
        ctx.mail.sent.length = 0;
        const res = await admin('post', '/support-sessions', {
          storeId,
          reason: 'Cliente pediu ajuda com os relatórios',
          minutes: 30,
        }).expect(201);
        sessionId = res.body.session.id;
        supportToken = decodeURIComponent(/#token=(.+)$/.exec(res.body.url)![1]!);

        const session = await ctx
          .http()
          .get('/api/support/session')
          .set(bearer(supportToken))
          .expect(200);
        expect(session.body.support).toMatchObject({
          mode: 'READ_ONLY',
          reason: 'Cliente pediu ajuda com os relatórios',
        });
        await ctx.http().get('/api/orders').set(bearer(supportToken)).expect(200);
        await ctx.http().post('/api/orders').set(bearer(supportToken)).send({}).expect(403);
        await ctx.http().get('/api/auth/me').set(bearer(supportToken)).expect(403);

        const notices = await ctx
          .http()
          .get('/api/stores/current/notices')
          .set(bearer(ownerToken))
          .expect(200);
        expect(notices.body.support).toMatchObject({ mode: 'READ_ONLY' });
        await vi.waitFor(() =>
          expect(ctx.mail.sent.some((m) => m.to === 'maria@cantina.test')).toBe(true),
        );

        const storeAudit = await ctx.prisma.auditLog.findFirst({
          where: { tenantId: storeId, action: 'support.started' },
        });
        expect(storeAudit).toMatchObject({ supportSessionId: sessionId });
      });

      it('ends the session and the token stops working', async () => {
        await admin('post', `/support-sessions/${sessionId}/end`).expect(200);
        await ctx.http().get('/api/orders').set(bearer(supportToken)).expect(401);
        const notices = await ctx
          .http()
          .get('/api/stores/current/notices')
          .set(bearer(ownerToken))
          .expect(200);
        expect(notices.body.support).toBeNull();
      });

      it('marks what a session "with changes" does in the store audit', async () => {
        const res = await admin('post', '/support-sessions', {
          storeId,
          reason: 'Ajustar o cadastro de mesas',
          minutes: 15,
          mode: 'READ_WRITE',
          confirmWrite: true,
        }).expect(201);
        const token = decodeURIComponent(/#token=(.+)$/.exec(res.body.url)![1]!);
        await ctx
          .http()
          .post('/api/users')
          .set(bearer(token))
          .send({
            name: 'Caixa Novo',
            email: 'caixa.novo@cantina.test',
            role: 'CASHIER',
            password: 'Senha1234',
          })
          .expect(201);
        const audit = await ctx.prisma.auditLog.findFirst({
          where: { tenantId: storeId, action: 'user.created' },
          orderBy: { seq: 'desc' },
        });
        expect(audit).toMatchObject({ supportSessionId: res.body.session.id });
        await admin('post', `/support-sessions/${res.body.session.id}/end`).expect(200);
      });
    });
  });

  describe('signup mode', () => {
    it('is invite-only when configured, open with trial otherwise', async () => {
      await admin('put', '/settings', {
        signupMode: 'INVITE_ONLY',
        signupPlanId: null,
        trialDays: 14,
        graceDays: 7,
        warnDaysBefore: 5,
      }).expect(200);
      const status = await ctx.http().get('/api/auth/signup-status').expect(200);
      expect(status.body.mode).toBe('INVITE_ONLY');
      await ctx
        .http()
        .post('/api/auth/register')
        .send({
          ownerName: 'Fulano',
          email: 'novo@teste.com',
          password: 'Senha1234',
          phone: '11987654321',
          tradeName: 'Novo',
          legalName: 'Novo LTDA',
          cnpj: '45723174000110',
        })
        .expect(403);
      // Open signup needs a plan.
      await admin('put', '/settings', {
        signupMode: 'OPEN_TRIAL',
        signupPlanId: null,
        trialDays: 14,
        graceDays: 7,
        warnDaysBefore: 5,
      }).expect(400);
      await admin('put', '/settings', {
        signupMode: 'OPEN_TRIAL',
        signupPlanId: TEST_PLAN_ID,
        trialDays: 14,
        graceDays: 7,
        warnDaysBefore: 5,
      }).expect(200);
      const store = await registerStore(ctx, { tradeName: 'Novo com teste' });
      const notices = await ctx
        .http()
        .get('/api/stores/current/notices')
        .set(bearer(store.accessToken))
        .expect(200);
      expect(notices.body.billing).toMatchObject({ level: 'TRIAL', readOnly: false });
    });

    it('shows the overview', async () => {
      const res = await admin('get', '/overview').expect(200);
      expect(res.body.counts.total).toBeGreaterThanOrEqual(3);
      expect(res.body.activity.length).toBeGreaterThan(0);
      expect(typeof res.body.mrrCents).toBe('number');
    });
  });
});
