/* eslint-disable no-console -- command line tool */
/**
 * Restores the public demo unit (slug `demo`), every night on the server (systemd timer, 04:00
 * America/Sao_Paulo). Only touches the demo unit: never the platform tables nor other customers.
 *
 *   node dist/cli/demo-reset.js --yes [--days 30]
 *
 * Runs only with DEMO_RESET_ENABLED=true in the environment and the --yes confirmation.
 * The first run creates the unit (and its organization); then link it to a plan in the platform
 * admin and accept the terms once as the owner (both are kept by the next resets).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  DEMO_PASSWORD,
  DEMO_USERS,
  PUBLIC_DEMO_HOURS,
  refreshDigitalMenu,
  resetDemoStore,
} from '../demo/demo-store.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  if (process.env.DEMO_RESET_ENABLED !== 'true') {
    throw new Error('demo-reset desligado: defina DEMO_RESET_ENABLED=true no .env deste servidor.');
  }
  if (!process.argv.includes('--yes')) {
    throw new Error('Confirme com --yes (apaga e recria tudo dentro da unidade demo).');
  }
  const days = Number(arg('days') ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 120) throw new Error('--days entre 1 e 120.');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL não definido');

  const started = Date.now();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    const demo = await resetDemoStore(prisma, {
      historyDays: days,
      hours: PUBLIC_DEMO_HOURS,
      demoMode: true,
    });
    await refreshDigitalMenu(demo.store.slug);
    console.log(
      `Demo restaurada em ${((Date.now() - started) / 1000).toFixed(1)} s: ${demo.history.orders} pedidos em ${demo.history.days} dias, ${DEMO_USERS.length} usuários (senha ${DEMO_PASSWORD}), modo demonstração ligado.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
