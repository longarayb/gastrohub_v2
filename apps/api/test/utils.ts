import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/core/prisma/prisma.service.js';
import { MAIL_PROVIDER, type MailMessage, type MailProvider } from '../src/core/mail/mail.types.js';
import { setupApp } from '../src/setup-app.js';

/** Captures e-mails instead of sending them. */
export class FakeMailProvider implements MailProvider {
  readonly sent: MailMessage[] = [];
  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }
}

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  mail: FakeMailProvider;
  http: () => ReturnType<typeof request>;
}

export async function createTestApp(): Promise<TestContext> {
  const mail = new FakeMailProvider();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MAIL_PROVIDER)
    .useValue(mail)
    .compile();
  const app = moduleRef.createNestApplication();
  setupApp(app);
  await app.init();
  const prisma = app.get(PrismaService);
  return { app, prisma, mail, http: () => request(app.getHttpServer()) };
}

/** Removes all data (keeps the schema). */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let counter = 0;
const VALID_CNPJS = ['11222333000181', '11444777000161', '45723174000110', '04252011000110'];

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
  const found = cookies.find((c) => c.startsWith('gh_refresh='));
  return found ? found.split(';')[0]! : '';
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
