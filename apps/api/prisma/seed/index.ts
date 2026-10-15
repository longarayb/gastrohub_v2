/* eslint-disable no-console -- CLI script that reports what it created */
/**
 * Demo data. Run with `pnpm db:seed` (re-runnable: the demo unit is wiped and recreated).
 * Credentials are DEMO ONLY and documented in the README.
 */
import path from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { config as loadEnv } from 'dotenv';
import { expand } from 'dotenv-expand';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  DEMO_PASSWORD,
  DEMO_USERS,
  deleteTenantRows,
  developmentDemoHours,
  refreshDigitalMenu,
  resetDemoStore,
} from '../../src/demo/demo-store.js';
import { seedRefusal } from '../../src/demo/seed-guard.js';
import {
  EXAMPLE_CUSTOMERS,
  EXAMPLE_PASSWORD,
  PLATFORM_DEMO,
  seedPlatform,
  wipePlatform,
} from './platform.js';

expand(
  loadEnv({ path: path.join(import.meta.dirname, '..', '..', '..', '..', '.env'), quiet: true }),
);

/** Removes one store with all its tenant rows (and its organization when left empty). */
async function wipeStore(prisma: PrismaClient, slug: string): Promise<void> {
  const store = await prisma.store.findUnique({ where: { slug } });
  if (!store) return;
  await deleteTenantRows((sql, ...values) => prisma.$executeRawUnsafe(sql, ...values), store.id);
  await prisma.store.delete({ where: { id: store.id } });
  if (!(await prisma.store.count({ where: { organizationId: store.organizationId } }))) {
    await prisma.organization.delete({ where: { id: store.organizationId } });
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido');
  // This seed empties the platform tables (admins, customers, invoices): development only. The
  // server uses `demo-reset`, which only touches the demo unit.
  const refusal = seedRefusal(process.env.NODE_ENV, url);
  if (refusal) throw new Error(refusal);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  const timing = (label: string, start: number) => {
    if (process.env.SEED_TIMINGS) console.log(`[seed] ${label}: ${Date.now() - start} ms`);
  };
  try {
    let t = Date.now();
    // Platform data first (subscriptions point to the organizations).
    await wipePlatform(prisma, (slug) => wipeStore(prisma, slug));
    timing('limpeza da plataforma', t);
    const demo = await resetDemoStore(prisma, {
      // HISTORY_DAYS=365 to measure the reports with a year of data (D038).
      historyDays: Number(process.env.HISTORY_DAYS) || 90,
      // Open now and for the next hours, in the same business day, at any time of day.
      hours: developmentDemoHours(),
      // The walkthroughs change passwords, users and settings: no demo mode in development.
      demoMode: false,
      timing: (label, ms) => {
        if (process.env.SEED_TIMINGS) console.log(`[seed] ${label}: ${ms} ms`);
      },
    });
    const { store, userIds, menu, orders, delivery, digital, history } = demo;
    t = Date.now();
    const platform = await seedPlatform(prisma, {
      organizationId: store.organizationId,
      storeId: store.id,
      ownerId: userIds.OWNER!,
      storeName: store.tradeName,
    });
    timing('plataforma', t);

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
      `✔ Entregas: ${delivery.areas} áreas (uma suspensa) · ${delivery.runs} saídas (uma acertada, uma aguardando acerto, duas em rota, uma com o entregador simulado) · app do entregador: entregador@demo.local`,
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
    console.log(
      `✔ Plataforma: ${platform.customers} clientes (${EXAMPLE_CUSTOMERS.map((x) => x.slug).join(', ')} + demo) · ${platform.invoices} mensalidades`,
    );
    console.log(
      `    Admin da plataforma (http://localhost:3002): ${PLATFORM_DEMO.email} · senha ${PLATFORM_DEMO.password} · 2FA com a chave ${PLATFORM_DEMO.totpSecret}`,
    );
    console.log(
      `    Donos de exemplo (senha ${EXAMPLE_PASSWORD}): ${EXAMPLE_CUSTOMERS.map((x) => x.owner.email).join(', ')}\n`,
    );
    await refreshDigitalMenu(store.slug);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
