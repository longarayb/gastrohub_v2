import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { MAIL_PROVIDER, type MailMessage, type MailProvider } from '../src/core/mail/mail.types.js';
import {
  FCM_PROVIDER,
  PUSH_PROVIDER,
  type PushMessage,
  type PushProvider,
  type PushTarget,
} from '../src/core/push/push.types.js';
import { setupApp } from '../src/setup-app.js';

/** Captures e-mails instead of sending them. */
export class FakeMailProvider implements MailProvider {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

/** Captures Web Push messages; endpoints in `gone` answer as deleted by the push service. */
export class FakePushProvider implements PushProvider {
  readonly publicKey = 'test-public-key';
  readonly sent: { target: PushTarget; message: PushMessage }[] = [];
  readonly gone = new Set<string>();
  async send(target: PushTarget, message: PushMessage): Promise<'sent' | 'gone' | 'failed'> {
    if (this.gone.has(target.endpoint)) return 'gone';
    this.sent.push({ target, message });
    return 'sent';
  }
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  mail: FakeMailProvider;
  push: FakePushProvider;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestContext> {
  const mail = new FakeMailProvider();
  const push = new FakePushProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PROVIDER)
    .useValue(mail)
    .overrideProvider(PUSH_PROVIDER)
    .useValue(push)
    .overrideProvider(FCM_PROVIDER)
    .useValue(push)
    .compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, mail, push, http: () => request(app.getHttpServer()) };
}

/** Removes all data (keeps the schema). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  await openSignupForTests(prisma);
}

export const TEST_PLAN_ID = 'plan-test-all-modules';

/**
 * The platform default is "signup by invitation only" (D043). The suites create restaurants
 * through the public signup, so the test database opens it with a plan that includes every
 * module (the stores start in trial, like a real open signup).
 */
export async function openSignupForTests(prisma: PrismaService): Promise<void> {
  await prisma.plan.create({
    data: {
      id: TEST_PLAN_ID,
      name: 'Plano de testes',
      priceCents: 19_900,
      interval: 'MONTHLY',
      trialDays: 14,
      storeLimit: 10,
      extraStorePriceCents: 4_900,
      modules: ['DIGITAL_MENU', 'DELIVERY', 'KDS', 'PRINTING', 'MARKETPLACES'],
    },
  });
  await prisma.platformSettings.create({
    data: { id: 'default', signupMode: 'OPEN_TRIAL', signupPlanId: TEST_PLAN_ID, trialDays: 14 },
  });
}

let counter = 0;
const VALID_CNPJS = ['99999999000191', '99999998000147', '99999997000100', '99999996000158'];

export interface RegisteredStore {
  accessToken: string;
  storeId: string;
  userId: string;
  email: string;
  password: string;
  cookie: string;
}

/** Registers a new restaurant (owner + store) through the public API. */
export async function registerStore(
  ctx: TestContext,
  overrides: Partial<{ tradeName: string; email: string }> = {},
): Promise<RegisteredStore> {
  counter++;
  const email = overrides.email ?? `dono${counter}-${Date.now()}@teste.com`;
  const password = 'Senha1234';
  const res = await ctx
    .http()
    .post('/api/auth/register')
    .send({
      ownerName: 'Dono Teste',
      email,
      password,
      phone: '11987654321',
      tradeName: overrides.tradeName ?? `Restaurante ${counter}`,
      legalName: `Restaurante ${counter} LTDA`,
      cnpj: VALID_CNPJS[counter % VALID_CNPJS.length],
    })
    .expect(201);
  return {
    accessToken: res.body.accessToken,
    storeId: res.body.store.id,
    userId: res.body.user.id,
    email,
    password,
    cookie: refreshCookie(res.headers['set-cookie']),
  };
}

export function refreshCookie(setCookie: string | string[] | undefined): string {
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const found = cookies.find((c) => c.startsWith('app_refresh='));
  return found ? found.split(';')[0]! : '';
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
