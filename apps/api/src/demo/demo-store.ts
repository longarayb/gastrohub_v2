/**
 * The demo unit, built in one place for the development seed (`prisma/seed/index.ts`) and the
 * production command `demo-reset` (`src/cli/demo-reset.ts`, every night on the server).
 *
 * The unit and its organization are KEPT (same ids): the platform points to them (subscription,
 * terms accepted, support sessions). Everything inside the unit is deleted and created again,
 * and every column of the unit goes back to the demo values (`demoStoreData`).
 */
import { BRAND, type BusinessHour } from '@app/shared';
import argon2 from 'argon2';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { seedDelivery } from './delivery.js';
import { seedDigitalMenu } from './digital-menu.js';
import { seedHistory } from './history.js';
import { DEMO_HOURS, demoHoursAround } from './hours.js';
import { seedMenu } from './menu.js';
import { seedOrders } from './orders.js';

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

/**
 * Public demo (production): open from 04:30 to 04:00 of the next day, every day, so a visitor
 * finds it open at any hour; the nightly reset (04:00) runs while it is closed.
 */
export const PUBLIC_DEMO_HOURS: BusinessHour[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: '04:30',
  closesAt: '04:00',
}));

/** Tenant tables in deletion order (children first). A new tenant table must be added here. */
export const TENANT_TABLES = [
  'CourierPosition',
  'GeocodeCache',
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

type Run = (sql: string, ...values: unknown[]) => Promise<unknown>;

export async function deleteTenantRows(run: Run, tenantId: string): Promise<void> {
  for (const table of TENANT_TABLES) {
    await run(`DELETE FROM "${table}" WHERE "tenantId" = $1`, tenantId);
  }
}

/** Empties a unit: every tenant row, fast when the user may skip the foreign key checks. */
export async function emptyStore(prisma: PrismaClient, storeId: string): Promise<void> {
  try {
    // Children first; the foreign key checks of each deleted row only cost time (90 days of
    // history). Needs a superuser (the local Docker user is one; production is not).
    await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
        await deleteTenantRows((sql, ...values) => tx.$executeRawUnsafe(sql, ...values), storeId);
      },
      { timeout: 120_000 },
    );
  } catch {
    await deleteTenantRows((sql, ...values) => prisma.$executeRawUnsafe(sql, ...values), storeId);
  }
}

/**
 * Every column of the demo unit, settings at their defaults. `demo-store.test.ts` fails when
 * `Store` gets a column this object does not set (a nightly reset would keep a visitor's change).
 */
export function demoStoreData(options: { demoMode: boolean }) {
  return {
    tradeName: `${BRAND.name} Demo`,
    legalName: `${BRAND.name} Demo LTDA`,
    cnpj: '11222333000181',
    phone: '11987654321',
    email: 'contato@demo.local',
    logoUrl: null,
    timezone: 'America/Sao_Paulo',
    isActive: true,
    demoMode: options.demoMode,
    addressCep: '01310100',
    addressStreet: 'Avenida Paulista',
    addressNumber: '1000',
    addressComplement: null,
    addressNeighborhood: 'Bela Vista',
    addressCity: 'São Paulo',
    addressState: 'SP',
    addressReference: null,
    latitude: -23.5649,
    longitude: -46.6519,
    serviceFeeBps: 1000,
    digitalMenuEnabled: true,
    deliveryMinimumCents: 0,
    takeoutEtaMinutes: 20,
    autoAcceptDigitalOrders: false,
    pizzaPricingRule: 'HIGHEST',
    serviceFeeOrderTypes: ['DINE_IN'],
    blindCashClose: true,
    courierPerDeliveryCents: 0,
    courierFeeShareBps: 0,
    courierDailyCents: 0,
    brandColor: null,
    menuCoverKey: null,
    menuDescription: null,
    privacyNotice: null,
    digitalLimitPhoneOpen: 2,
    digitalLimitPhoneDay: 10,
    digitalLimitIpHour: 30,
    digitalLimitStorePending: 20,
    // Demo PIX key (fictitious): the QR Code is valid but pays no one.
    pixKeyType: 'EMAIL',
    pixKey: 'pix@demo.local',
    pixMerchantName: `${BRAND.name} Demo`.slice(0, 25),
    pixMerchantCity: 'São Paulo',
    printCashPrinterId: null,
    printDeliveryCopyOnAccept: true,
    printDeliveryCopies: 1,
    printCancelSlips: true,
    printHoldAfterMinutes: 30,
  } satisfies Omit<Prisma.StoreUncheckedCreateInput, 'id' | 'organizationId' | 'slug'>;
}

export interface DemoOptions {
  /** Days of history for the dashboard (development: 90; public demo: 30). */
  historyDays: number;
  /** Opening hours saved for the unit. */
  hours: BusinessHour[];
  /** Public demo: sensitive actions blocked (D045). */
  demoMode: boolean;
  /** Called with a label and the elapsed milliseconds of each part (SEED_TIMINGS). */
  timing?: (label: string, ms: number) => void;
}

export interface DemoResult {
  store: { id: string; organizationId: string; slug: string; tradeName: string };
  userIds: Record<string, string>;
  menu: Awaited<ReturnType<typeof seedMenu>>;
  orders: Awaited<ReturnType<typeof seedOrders>>;
  delivery: Awaited<ReturnType<typeof seedDelivery>>;
  digital: Awaited<ReturnType<typeof seedDigitalMenu>>;
  history: Awaited<ReturnType<typeof seedHistory>>;
}

/** Creates the demo unit, or empties it and fills it again. Only touches the demo unit. */
export async function resetDemoStore(
  prisma: PrismaClient,
  options: DemoOptions,
): Promise<DemoResult> {
  let t = Date.now();
  const lap = (label: string) => {
    options.timing?.(label, Date.now() - t);
    t = Date.now();
  };
  const data = demoStoreData({ demoMode: options.demoMode });
  const existing = await prisma.store.findUnique({ where: { slug: DEMO_SLUG } });
  let store;
  if (existing) {
    await emptyStore(prisma, existing.id);
    store = await prisma.store.update({ where: { id: existing.id }, data });
  } else {
    const org = await prisma.organization.create({ data: { name: `${BRAND.name} Demo LTDA` } });
    store = await prisma.store.create({
      data: { ...data, organizationId: org.id, slug: DEMO_SLUG },
    });
  }
  // Demo users are global rows: removed (sessions and reset tokens go with them) and created.
  await prisma.user.deleteMany({ where: { email: { in: DEMO_USERS.map((u) => u.email) } } });
  await prisma.businessHours.createMany({
    data: options.hours.map((h) => ({ ...h, tenantId: store.id })),
  });
  lap('limpeza e unidade');

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
  lap('usuários');

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
  lap('cardápio, pedidos de hoje, entregas e cardápio digital');
  const history = await seedHistory(
    prisma,
    store.id,
    {
      cashierId: userIds.CASHIER!,
      waiterId: userIds.WAITER!,
      managerId: userIds.MANAGER!,
      ownerId: userIds.OWNER!,
    },
    options.historyDays,
  );
  lap('histórico');
  return { store, userIds, menu, orders, delivery, digital, history };
}

/**
 * The reset writes straight to the database, so the digital menu (if running) would keep its
 * cached pages: ask it to refresh, like the API does after a change. Menu not running: fine.
 */
export async function refreshDigitalMenu(slug: string): Promise<void> {
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

/** Development hours: open now and for 3 h in the same business day (any time of day). */
export const developmentDemoHours = (now = new Date()) => demoHoursAround(DEMO_HOURS, now);
