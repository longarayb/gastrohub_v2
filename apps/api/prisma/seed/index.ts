/* eslint-disable no-console -- CLI script that reports what it created */
/**
 * Demo data. Run with `pnpm db:seed` (re-runnable: the demo unit is wiped and recreated).
 * Credentials are DEMO ONLY and documented in the README.
 */
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { BRAND } from '@app/shared';
import argon2 from 'argon2';
import { config as loadEnv } from 'dotenv';
import { expand } from 'dotenv-expand';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { seedMenu } from './menu.js';
import { seedDelivery } from './delivery.js';
import { seedHistory } from './history.js';
import { DEMO_HOURS, demoHoursAround } from './hours.js';
import { seedDigitalMenu } from './digital-menu.js';
import { seedOrders } from './orders.js';

expand(
  loadEnv({ path: path.join(import.meta.dirname, '..', '..', '..', '..', '.env'), quiet: true }),
);

export const DEMO_SLUG = 'demo';
export const DEMO_PASSWORD = 'Demo1234';
export const DEMO_USERS = [
  { email: 'dono@demo.local', name: 'Ana Dona', role: 'OWNER' },
  { email: 'gerente@demo.local', name: 'Bruno Gerente', role: 'MANAGER' },
  { email: 'caixa@demo.local', name: 'Carla Caixa', role: 'CASHIER' },
  { email: 'garcom@demo.local', name: 'Diego Garçom', role: 'WAITER' },
  { email: 'cozinha@demo.local', name: 'Elisa Cozinha', role: 'KITCHEN' },
  { email: 'entregador@demo.local', name: 'Fábio Entregador', role: 'COURIER' },
] as const;

/** Tenant tables in deletion order (children first). Store rows are tenant-scoped by tenantId. */
const TENANT_TABLES = [
  'PrintJob',
  'Printer',
  'PrintAgent',
  'BlockedPhone',
  'DeliveryQuoteMiss',
  'CourierLedgerEntry',
  'DeliveryStop',
  'OrderDelivery',
  'DeliveryRun',
  'CourierSettlement',
  'DeliveryArea',
  'ProductionTask',
  'KdsDevice',
  'Payment',
  'CashSessionCount',
  'CashMovement',
  'CashSession',
  'OrderStatusHistory',
  'OrderItem',
  'OrderRound',
  'Order',
  'OrderSequence',
  'Coupon',
  'Courier',
  'CustomerAddress',
  'Customer',
  'TableSessionTable',
  'TableSession',
  'Table',
  'Area',
  'ModifierOptionSizePrice',
  'ModifierGroupLink',
  'ModifierOption',
  'ModifierGroup',
  'ProductSizePrice',
  'AvailabilitySchedule',
  'Size',
  'Product',
  'Category',
  'ProductionSector',
  'AuditLog',
  'BusinessHours',
  'Membership',
] as const;

async function deleteTenantRows(
  run: (sql: string, ...values: unknown[]) => Promise<unknown>,
  tenantId: string,
): Promise<void> {
  for (const table of TENANT_TABLES) {
    await run(`DELETE FROM "${table}" WHERE "tenantId" = $1`, tenantId);
  }
}

async function wipeDemo(prisma: PrismaClient): Promise<void> {
  const store = await prisma.store.findUnique({ where: { slug: DEMO_SLUG } });
  if (!store) return;
  try {
    // Every table of the unit is emptied (children first): the foreign key checks of each
    // deleted row only cost time (90 days of history). Needs a superuser (the local Docker
    // user is one); otherwise the plain deletes below run instead.
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
        await deleteTenantRows((sql, ...values) => tx.$executeRawUnsafe(sql, ...values), store.id);
      },
      { timeout: 120_000 },
    );
  } catch {
    await deleteTenantRows((sql, ...values) => prisma.$executeRawUnsafe(sql, ...values), store.id);
  }
  await prisma.user.deleteMany({ where: { email: { in: DEMO_USERS.map((u) => u.email) } } });
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.organization.delete({ where: { id: store.organizationId } });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const timing = (label: string, start: number) => {
    if (process.env.SEED_TIMINGS) console.log(`[seed] ${label}: ${Date.now() - start} ms`);
  };
  try {
    let t = Date.now();
    await wipeDemo(prisma);
    timing('limpeza', t);
    t = Date.now();

    const org = await prisma.organization.create({ data: { name: `${BRAND.name} Demo LTDA` } });
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        slug: DEMO_SLUG,
        tradeName: `${BRAND.name} Demo`,
        legalName: `${BRAND.name} Demo LTDA`,
        cnpj: '11222333000181',
        phone: '11987654321',
        email: 'contato@demo.local',
        addressCep: '01310100',
        addressStreet: 'Avenida Paulista',
        addressNumber: '1000',
        addressNeighborhood: 'Bela Vista',
        addressCity: 'São Paulo',
        addressState: 'SP',
        latitude: -23.5649,
        longitude: -46.6519,
        pizzaPricingRule: 'HIGHEST',
        // Demo PIX key (fictitious): the QR Code is valid but pays no one.
        pixKeyType: 'EMAIL',
        pixKey: 'pix@demo.local',
        pixMerchantName: `${BRAND.name} Demo`.slice(0, 25),
        pixMerchantCity: 'São Paulo',
        // Open now and for the next hours, in the same business day, at any time of day.
        businessHours: { createMany: { data: demoHoursAround(DEMO_HOURS, new Date()) } },
      },
    });

    const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
    const userIds: Record<string, string> = {};
    for (const user of DEMO_USERS) {
      const created = await prisma.user.create({
        data: {
          name: user.name,
          email: user.email,
          passwordHash,
          lastStoreId: store.id,
          memberships: { create: { tenantId: store.id, role: user.role } },
        },
      });
      userIds[user.role] = created.id;
    }

    timing('unidade e usuários', t);
    t = Date.now();
    const menu = await seedMenu(prisma, store.id);
    const orders = await seedOrders(prisma, store.id, {
      cashierId: userIds.CASHIER!,
      waiterId: userIds.WAITER!,
      managerId: userIds.MANAGER!,
    });
    const delivery = await seedDelivery(prisma, store.id, {
      courierUserId: userIds.COURIER!,
      managerId: userIds.MANAGER!,
      cashierId: userIds.CASHIER!,
    });
    const digital = await seedDigitalMenu(prisma, store.id, { managerId: userIds.MANAGER! });
    timing('cardápio, pedidos de hoje, entregas e cardápio digital', t);
    t = Date.now();
    const history = await seedHistory(
      prisma,
      store.id,
      {
        cashierId: userIds.CASHIER!,
        waiterId: userIds.WAITER!,
        managerId: userIds.MANAGER!,
        ownerId: userIds.OWNER!,
      },
      // HISTORY_DAYS=365 to measure the reports with a year of data (D038).
      Number(process.env.HISTORY_DAYS) || 90,
    );
    timing('histórico', t);

    console.log(`\n✔ Unidade "${store.tradeName}" (slug: ${store.slug})`);
    console.log(`✔ ${DEMO_USERS.length} usuários — senha de demonstração: ${DEMO_PASSWORD}`);
    for (const u of DEMO_USERS) console.log(`    ${u.role.padEnd(8)} ${u.email}`);
    console.log(
      `✔ Cardápio: ${menu.categories} categorias, ${menu.products} produtos, ${menu.groups} grupos de complementos`,
    );
    console.log(
      `✔ Pedidos de hoje: ${orders.orders} · ${orders.tables} mesas · ${orders.customers} clientes · cupons BEMVINDO10 e FRETEGRATIS`,
    );
    console.log(
      `✔ Caixas: ${orders.cashSessions} (gerente: fechado com diferença; caixa: aberto) · PIX pix@demo.local`,
    );
    console.log(
      `✔ Entregas: ${delivery.areas} áreas (uma suspensa) · ${delivery.runs} saídas (uma acertada, uma aguardando acerto, uma em rota) · app do entregador: entregador@demo.local`,
    );
    console.log(
      `✔ Cardápio digital: http://localhost:3001/${store.slug} · ${digital.menuOrders} pedidos pelo cardápio · telefone bloqueado (11) 90000-0000`,
    );
    console.log(
      `✔ Histórico: ${history.orders} pedidos em ${history.days} dias de negócio (dashboard e relatórios)`,
    );
    console.log(
      `✔ Cozinha: ${orders.kitchenTasks} tarefas de produção · tela "TV da cozinha" aguardando vínculo (Setores)\n`,
    );
    await refreshDigitalMenu(store.slug);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * The seed writes straight to the database, so the digital menu (if running) would keep its
 * cached pages: ask it to refresh, like the API does after a change. Menu not running: fine.
 */
async function refreshDigitalMenu(slug: string): Promise<void> {
  const url = process.env.MENU_INTERNAL_URL ?? 'http://localhost:3001';
  const secret = process.env.MENU_REVALIDATE_SECRET;
  if (!secret) return;
  try {
    await fetch(`${url}/api/revalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-revalidate-secret': secret },
      body: JSON.stringify({ slug }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The menu app is not running: it reads fresh data when it starts.
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
