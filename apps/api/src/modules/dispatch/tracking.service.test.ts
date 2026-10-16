import { TRACKING_CONSENT_VERSION } from '@app/shared';
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../core/config/app-config.service.js';
import type { PrismaService } from '../../core/prisma/prisma.service.js';
import type { TenantContext } from '../../core/tenancy/tenant-context.js';
import { TrackingService } from './tracking.service.js';

const DEMO_MESSAGE = /demonstração pública/;

function service(options: { production: boolean; lan: boolean; demoMode: boolean }) {
  const config = {
    isProduction: options.production,
    get: (key: string) => (key === 'LAN_SERVER' ? options.lan : undefined),
  } as unknown as AppConfig;
  const prisma = {
    store: { findUnique: async () => ({ demoMode: options.demoMode }) },
  } as unknown as PrismaService;
  // No signed-in user: past the demo check, the service refuses with a plain 403.
  const ctx = { tenantId: 'store-1', userId: null } as unknown as TenantContext;
  const unused = {} as never;
  return new TrackingService(unused, prisma, ctx, unused, unused, unused, config);
}

describe('real location in the public demo (D049)', () => {
  it('the public demo never takes a real position or consent', async () => {
    const demo = service({ production: true, lan: false, demoMode: true });
    await expect(demo.consent(TRACKING_CONSENT_VERSION)).rejects.toThrow(DEMO_MESSAGE);
    await expect(
      demo.ingest({
        positions: [{ latitude: 0, longitude: 0, recordedAt: new Date().toISOString() }],
      }),
    ).rejects.toThrow(DEMO_MESSAGE);
  });

  it('a real restaurant, the home network server and development go on', async () => {
    for (const options of [
      { production: true, lan: false, demoMode: false },
      { production: true, lan: true, demoMode: true },
      { production: false, lan: false, demoMode: true },
    ]) {
      const error = await service(options)
        .consent(TRACKING_CONSENT_VERSION)
        .catch((e: Error) => e);
      expect((error as Error).message).not.toMatch(DEMO_MESSAGE);
    }
  });
});
