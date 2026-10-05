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
  'Payment',
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

async function wipeDemo(prisma: PrismaClient): Promise<void> {
  const store = await prisma.store.findUnique({ where: { slug: DEMO_SLUG } });
  if (!store) return;
  for (const table of TENANT_TABLES) {
    await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "tenantId" = $1`, store.id);
  }
  await prisma.user.deleteMany({ where: { email: { in: DEMO_USERS.map((u) => u.email) } } });
  await prisma.store.delete({ where: { id: store.id } });
  await prisma.organization.delete({ where: { id: store.organizationId } });
}

// Fri/Sat night shifts cross midnight (they belong to the day they start).
const HOURS = [
  ...[2, 3, 4].flatMap((weekday) => [
    { weekday, opensAt: '11:00', closesAt: '15:00' },
    { weekday, opensAt: '18:00', closesAt: '23:30' },
  ]),
  ...[5, 6].flatMap((weekday) => [
    { weekday, opensAt: '11:00', closesAt: '15:00' },
    { weekday, opensAt: '18:00', closesAt: '02:00' },
  ]),
  { weekday: 0, opensAt: '11:00', closesAt: '16:00' },
  { weekday: 1, opensAt: '11:00', closesAt: '15:00' },
];

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  try {
    await wipeDemo(prisma);

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
        businessHours: { createMany: { data: HOURS } },
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

    const menu = await seedMenu(prisma, store.id);
    const orders = await seedOrders(prisma, store.id, {
      cashierId: userIds.CASHIER!,
      waiterId: userIds.WAITER!,
    });

    console.log(`\n✔ Unidade "${store.tradeName}" (slug: ${store.slug})`);
    console.log(`✔ ${DEMO_USERS.length} usuários — senha de demonstração: ${DEMO_PASSWORD}`);
    for (const u of DEMO_USERS) console.log(`    ${u.role.padEnd(8)} ${u.email}`);
    console.log(
      `✔ Cardápio: ${menu.categories} categorias, ${menu.products} produtos, ${menu.groups} grupos de complementos`,
    );
    console.log(
      `✔ Pedidos de hoje: ${orders.orders} · ${orders.tables} mesas · ${orders.customers} clientes · cupons BEMVINDO10 e FRETEGRATIS\n`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
