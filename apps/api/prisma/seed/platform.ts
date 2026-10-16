/**
 * Platform admin demo data (feat/platform-admin, D041–D044): one platform admin with a KNOWN
 * second factor (demo only), three plans, the Demo restaurant as an active customer and four
 * example customers in other situations (trial, overdue in grace, read-only, canceled).
 * Everything here is fictitious. Re-runnable: platform tables are emptied and recreated.
 */
import {
  PLATFORM_PRIVACY_VERSION,
  PLATFORM_TERMS_VERSION,
  addDaysToDate,
  billingDate,
  billingPeriod,
  subscriptionCharge,
} from '@app/shared';
import argon2 from 'argon2';
import type { BillingInterval, PrismaClient } from '../../src/generated/prisma/client.js';
import { encryptSecret, parseSecretsKey } from '../../src/modules/platform/security/two-factor.js';

/** DEMO ONLY (documented in the README and docs/SETUP.md): never reuse in production. */
export const PLATFORM_DEMO = {
  email: 'admin@plataforma.local',
  name: 'Admin da Plataforma',
  password: 'Plataforma123',
  /** Base32 TOTP secret: add it to an authenticator app, or let the walkthroughs compute codes. */
  totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  recoveryCodes: Array.from({ length: 10 }, (_, i) => `RECUP-${String(i + 1).padStart(5, '0')}`),
};

export const EXAMPLE_PASSWORD = 'Demo1234';

/** Example customers: slug, situation and owner (password EXAMPLE_PASSWORD unless invited). */
export const EXAMPLE_CUSTOMERS = [
  {
    slug: 'pizzaria-bella-massa',
    name: 'Pizzaria Bella Massa',
    situation: 'TRIAL',
    owner: { name: 'Paula Teste', email: 'dono.teste@exemplo.local' },
    cnpj: '99999998000147',
  },
  {
    slug: 'lanchonete-do-ze',
    name: 'Lanchonete do Zé',
    situation: 'PAST_DUE',
    owner: { name: 'José Atrasado', email: 'dono.atrasado@exemplo.local' },
    cnpj: '99999997000100',
  },
  {
    slug: 'bar-do-porto',
    name: 'Bar do Porto',
    situation: 'READ_ONLY',
    owner: { name: 'Rita Suspensa', email: 'dono.suspenso@exemplo.local' },
    cnpj: '99999996000158',
  },
  {
    slug: 'cafe-central',
    name: 'Café Central',
    situation: 'CANCELED',
    owner: { name: 'Caio Cancelado', email: 'dono.cancelado@exemplo.local' },
    cnpj: '99999995000103',
  },
] as const;

/** Invited manager of the trial customer (no password yet: "Convite pendente"). */
const PENDING_INVITE = { name: 'Gabi Convidada', email: 'gerente.convite@exemplo.local' };

const PLATFORM_TABLES = [
  'PlatformAuditLog',
  'PlatformRecoveryCode',
  'PlatformSession',
  'PlatformAdmin',
  'SupportSession',
  'TermsAcceptance',
  'PlatformInvoice',
  'SubscriptionChange',
  'Subscription',
  'Plan',
] as const;

const STORE_HOURS = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  opensAt: '11:00',
  closesAt: '23:00',
}));

/** Empties the platform tables and removes the example customers (`wipeStore` per slug). */
export async function wipePlatform(
  prisma: PrismaClient,
  wipeStore: (slug: string) => Promise<void>,
): Promise<void> {
  // TRUNCATE: the platform audit is append-only (UPDATE/DELETE blocked by a trigger).
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${PLATFORM_TABLES.map((t) => `"${t}"`).join(', ')} CASCADE`,
  );
  for (const c of EXAMPLE_CUSTOMERS) await wipeStore(c.slug);
  await prisma.user.deleteMany({
    where: {
      email: { in: [...EXAMPLE_CUSTOMERS.map((c) => c.owner.email), PENDING_INVITE.email] },
    },
  });
}

interface InvoiceSeed {
  status: 'OPEN' | 'PAID';
}

export async function seedPlatform(
  prisma: PrismaClient,
  demo: { organizationId: string; storeId: string; ownerId: string; storeName: string },
): Promise<{ customers: number; invoices: number }> {
  const key = parseSecretsKey(process.env.PLATFORM_SECRETS_KEY);
  const today = billingDate(new Date());

  // ---- Admin (known 2FA: demo only) ----
  const admin = await prisma.platformAdmin.create({
    data: {
      email: PLATFORM_DEMO.email,
      name: PLATFORM_DEMO.name,
      passwordHash: await argon2.hash(PLATFORM_DEMO.password, { type: argon2.argon2id }),
      totpSecretEnc: encryptSecret(PLATFORM_DEMO.totpSecret, key),
      totpEnabledAt: new Date(),
      lastLoginAt: new Date(Date.now() - 3_600_000),
    },
  });
  for (const code of PLATFORM_DEMO.recoveryCodes) {
    await prisma.platformRecoveryCode.create({
      data: { adminId: admin.id, codeHash: await argon2.hash(code, { type: argon2.argon2id }) },
    });
  }

  // ---- Plans ----
  const essencial = await prisma.plan.create({
    data: {
      name: 'Essencial',
      description: 'Uma unidade com PDV, mesas, cozinha e impressão.',
      priceCents: 14_900,
      interval: 'MONTHLY',
      trialDays: 14,
      storeLimit: 1,
      extraStorePriceCents: null,
      modules: ['KDS', 'PRINTING'],
      sortOrder: 0,
    },
  });
  const completo = await prisma.plan.create({
    data: {
      name: 'Completo',
      description: 'Tudo do Essencial, mais cardápio digital e delivery.',
      priceCents: 24_900,
      interval: 'MONTHLY',
      trialDays: 14,
      storeLimit: 1,
      extraStorePriceCents: 9_900,
      modules: ['DIGITAL_MENU', 'DELIVERY', 'KDS', 'PRINTING'],
      sortOrder: 1,
    },
  });
  await prisma.plan.create({
    data: {
      name: 'Rede',
      description: 'Para redes: até 5 unidades, com integrações com marketplaces quando existirem.',
      priceCents: 499_000,
      interval: 'YEARLY',
      trialDays: 30,
      storeLimit: 5,
      extraStorePriceCents: 79_000,
      modules: ['DIGITAL_MENU', 'DELIVERY', 'KDS', 'PRINTING', 'MARKETPLACES'],
      sortOrder: 2,
    },
  });
  await prisma.platformSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', signupMode: 'INVITE_ONLY', signupPlanId: essencial.id },
    update: {
      signupMode: 'INVITE_ONLY',
      signupPlanId: essencial.id,
      trialDays: 14,
      graceDays: 7,
      warnDaysBefore: 5,
    },
  });

  const audit = (data: {
    action: string;
    entity: string;
    entityId?: string;
    organizationId?: string;
    storeId?: string;
    reason?: string;
    after?: object;
    at: Date;
  }) =>
    prisma.platformAuditLog.create({
      data: {
        adminId: admin.id,
        action: data.action,
        entity: data.entity,
        entityId: data.entityId ?? null,
        organizationId: data.organizationId ?? null,
        storeId: data.storeId ?? null,
        reason: data.reason ?? null,
        after: data.after,
        ip: '127.0.0.1',
        userAgent: 'seed',
        createdAt: data.at,
      },
    });
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
  await audit({
    action: 'admin.created',
    entity: 'PlatformAdmin',
    entityId: admin.id,
    at: daysAgo(120),
  });

  let invoiceCount = 0;
  /** Subscription with invoices: every period due up to `paidUntil` is paid, the rest open. */
  async function subscribe(input: {
    organizationId: string;
    planId: string;
    priceCents: number;
    interval: BillingInterval;
    storeLimit: number;
    extraStorePriceCents: number | null;
    billingStart: string;
    trialEndsOn?: string | null;
    canceledAt?: Date | null;
    invoices: InvoiceSeed[];
  }) {
    const subscription = await prisma.subscription.create({
      data: {
        organizationId: input.organizationId,
        planId: input.planId,
        priceCents: input.priceCents,
        interval: input.interval,
        startedAt: new Date(
          `${input.trialEndsOn ? addDaysToDate(input.billingStart, -14) : input.billingStart}T12:00:00-03:00`,
        ),
        trialEndsOn: input.trialEndsOn ?? null,
        billingStart: input.billingStart,
        canceledAt: input.canceledAt ?? null,
        cancelReason: input.canceledAt ? 'Restaurante fechou as portas' : null,
      },
    });
    await prisma.subscriptionChange.create({
      data: {
        subscriptionId: subscription.id,
        kind: 'CREATED',
        toPlanId: input.planId,
        after: { priceCents: input.priceCents, billingStart: input.billingStart },
        adminId: admin.id,
      },
    });
    if (input.canceledAt) {
      await prisma.subscriptionChange.create({
        data: {
          subscriptionId: subscription.id,
          kind: 'CANCELED',
          reason: 'Restaurante fechou as portas',
          adminId: admin.id,
          createdAt: input.canceledAt,
        },
      });
    }
    const amount = subscriptionCharge(
      {
        priceCents: input.priceCents,
        storeLimit: input.storeLimit,
        extraStorePriceCents: input.extraStorePriceCents,
      },
      1,
    );
    for (const [i, inv] of input.invoices.entries()) {
      const period = billingPeriod(
        { billingStart: input.billingStart, interval: input.interval },
        i,
      );
      await prisma.platformInvoice.create({
        data: {
          organizationId: input.organizationId,
          subscriptionId: subscription.id,
          ...period,
          amountCents: amount.totalCents,
          details: {
            ...amount,
            planName: (await prisma.plan.findUniqueOrThrow({ where: { id: input.planId } })).name,
          },
          status: inv.status,
          paidOn: inv.status === 'PAID' ? addDaysToDate(period.dueDate, 1) : null,
          paidAt:
            inv.status === 'PAID'
              ? new Date(`${addDaysToDate(period.dueDate, 1)}T15:00:00-03:00`)
              : null,
          paymentMethod: inv.status === 'PAID' ? (i % 2 ? 'BOLETO' : 'PIX') : null,
          createdById: admin.id,
        },
      });
      invoiceCount++;
    }
    return subscription;
  }

  /** Number of whole monthly periods from `start` up to today (plus the current one). */
  const monthlyPeriodsSince = (start: string) => {
    let n = 0;
    while (billingPeriod({ billingStart: start, interval: 'MONTHLY' }, n).periodStart <= today) n++;
    return n;
  };

  // ---- Demo restaurant: active, Completo, invoices paid (the walkthroughs keep working) ----
  await prisma.organization.update({
    where: { id: demo.organizationId },
    data: {
      createdVia: 'ADMIN',
      documentType: 'CNPJ',
      document: '99999999000191',
      legalName: 'Restaurante Demo LTDA',
      invoiceEmail: 'financeiro@demo.local',
      contactName: 'Ana Dona',
      contactEmail: 'dono@demo.local',
      contactPhone: '11900000010',
      addressCep: '01310100',
      addressStreet: 'Avenida Paulista',
      addressNumber: '1000',
      addressNeighborhood: 'Bela Vista',
      addressCity: 'São Paulo',
      addressState: 'SP',
    },
  });
  const demoStart = addDaysToDate(today, -100);
  const demoPeriods = monthlyPeriodsSince(demoStart);
  await subscribe({
    organizationId: demo.organizationId,
    planId: completo.id,
    priceCents: completo.priceCents,
    interval: 'MONTHLY',
    storeLimit: completo.storeLimit,
    extraStorePriceCents: completo.extraStorePriceCents,
    billingStart: demoStart,
    invoices: Array.from({ length: demoPeriods }, () => ({ status: 'PAID' as const })),
  });
  // The owner already accepted the current terms (otherwise the demo opens with the dialog).
  await prisma.termsAcceptance.create({
    data: {
      organizationId: demo.organizationId,
      userId: demo.ownerId,
      termsVersion: PLATFORM_TERMS_VERSION,
      privacyVersion: PLATFORM_PRIVACY_VERSION,
      ip: '127.0.0.1',
      userAgent: 'seed',
      acceptedAt: daysAgo(99),
    },
  });
  await audit({
    action: 'customer.created',
    entity: 'Organization',
    entityId: demo.organizationId,
    organizationId: demo.organizationId,
    at: daysAgo(100),
  });
  // A past support session (history), recorded in both audits.
  const support = await prisma.supportSession.create({
    data: {
      adminId: admin.id,
      organizationId: demo.organizationId,
      storeId: demo.storeId,
      reason: 'Dúvida do dono sobre o fechamento de caixa',
      mode: 'READ_ONLY',
      startedAt: daysAgo(3),
      endsAt: new Date(daysAgo(3).getTime() + 30 * 60_000),
      endedAt: new Date(daysAgo(3).getTime() + 18 * 60_000),
      ip: '127.0.0.1',
    },
  });
  await audit({
    action: 'support.started',
    entity: 'SupportSession',
    entityId: support.id,
    organizationId: demo.organizationId,
    storeId: demo.storeId,
    reason: support.reason,
    at: support.startedAt,
  });
  await audit({
    action: 'support.ended',
    entity: 'SupportSession',
    entityId: support.id,
    organizationId: demo.organizationId,
    storeId: demo.storeId,
    at: support.endedAt!,
  });

  // ---- Example customers ----
  const passwordHash = await argon2.hash(EXAMPLE_PASSWORD, { type: argon2.argon2id });
  for (const [index, c] of EXAMPLE_CUSTOMERS.entries()) {
    const org = await prisma.organization.create({
      data: {
        name: c.name,
        createdVia: 'ADMIN',
        documentType: 'CNPJ',
        document: c.cnpj,
        legalName: `${c.name} LTDA`,
        invoiceEmail: c.owner.email,
        contactName: c.owner.name,
        contactPhone: '11900000011',
        addressCep: '01310100',
        addressStreet: 'Avenida Paulista',
        addressNumber: String(1100 + index * 100),
        addressNeighborhood: 'Bela Vista',
        addressCity: 'São Paulo',
        addressState: 'SP',
        createdAt: daysAgo(60 - index * 10),
      },
    });
    const store = await prisma.store.create({
      data: {
        organizationId: org.id,
        slug: c.slug,
        tradeName: c.name,
        legalName: `${c.name} LTDA`,
        cnpj: c.cnpj,
        phone: '11900000011',
        email: c.owner.email,
        businessHours: { createMany: { data: STORE_HOURS } },
      },
    });
    const owner = await prisma.user.create({
      data: {
        name: c.owner.name,
        email: c.owner.email,
        passwordHash,
        lastStoreId: store.id,
        memberships: { create: { tenantId: store.id, role: 'OWNER' } },
      },
    });
    await prisma.termsAcceptance.create({
      data: {
        organizationId: org.id,
        userId: owner.id,
        termsVersion: PLATFORM_TERMS_VERSION,
        privacyVersion: PLATFORM_PRIVACY_VERSION,
        ip: '127.0.0.1',
        userAgent: 'seed',
      },
    });
    await audit({
      action: 'customer.created',
      entity: 'Organization',
      entityId: org.id,
      organizationId: org.id,
      storeId: store.id,
      after: { customer: c.name, owner: c.owner.email },
      at: daysAgo(60 - index * 10),
    });

    const plan = essencial;
    const base = {
      organizationId: org.id,
      planId: plan.id,
      priceCents: plan.priceCents,
      interval: 'MONTHLY' as const,
      storeLimit: plan.storeLimit,
      extraStorePriceCents: plan.extraStorePriceCents,
    };
    if (c.situation === 'TRIAL') {
      // Trial ends in 4 days: the owner sees the trial banner.
      const trialEndsOn = addDaysToDate(today, 4);
      await subscribe({ ...base, billingStart: trialEndsOn, trialEndsOn, invoices: [] });
      // A manager invited and not accepted yet.
      await prisma.user.create({
        data: {
          name: PENDING_INVITE.name,
          email: PENDING_INVITE.email,
          passwordHash: '!invite-pending',
          lastStoreId: store.id,
          memberships: { create: { tenantId: store.id, role: 'MANAGER' } },
        },
      });
    } else if (c.situation === 'PAST_DUE') {
      // Second invoice overdue for 4 days: still in the 7-day grace.
      const start = addDaysToDate(today, -34);
      const n = monthlyPeriodsSince(start);
      await subscribe({
        ...base,
        billingStart: start,
        invoices: Array.from(
          { length: n },
          (_, i) => ({ status: i === 0 ? 'PAID' : 'OPEN' }) as InvoiceSeed,
        ),
      });
    } else if (c.situation === 'READ_ONLY') {
      // Overdue for ~20 days: grace is over, the store is read-only (outside its hours).
      const start = addDaysToDate(today, -50);
      const n = monthlyPeriodsSince(start);
      await subscribe({
        ...base,
        billingStart: start,
        invoices: Array.from(
          { length: n },
          (_, i) => ({ status: i === 0 ? 'PAID' : 'OPEN' }) as InvoiceSeed,
        ),
      });
    } else {
      // Canceled 5 days ago after paying everything.
      const start = addDaysToDate(today, -70);
      const canceledAt = daysAgo(5);
      let n = 0;
      while (
        billingPeriod({ billingStart: start, interval: 'MONTHLY' }, n).periodStart <
        billingDate(canceledAt)
      )
        n++;
      await subscribe({
        ...base,
        billingStart: start,
        canceledAt,
        invoices: Array.from({ length: n }, () => ({ status: 'PAID' as const })),
      });
      await audit({
        action: 'subscription.canceled',
        entity: 'Subscription',
        organizationId: org.id,
        reason: 'Restaurante fechou as portas',
        at: canceledAt,
      });
    }
  }
  await audit({
    action: 'invoice.paid',
    entity: 'PlatformInvoice',
    organizationId: demo.organizationId,
    after: { method: 'PIX' },
    at: daysAgo(1),
  });

  return { customers: EXAMPLE_CUSTOMERS.length + 1, invoices: invoiceCount };
}
