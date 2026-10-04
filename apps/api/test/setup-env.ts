import path from 'node:path';
import { config as loadEnv } from 'dotenv';

// e2e tests run against the dedicated test database.
loadEnv({ path: path.join(import.meta.dirname, '..', '..', '..', '.env'), quiet: true });
process.env.NODE_ENV = 'test';
// Suites create many accounts quickly; throttle.e2e.test.ts re-enables it.
process.env.THROTTLE_DISABLED = 'true';
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}
