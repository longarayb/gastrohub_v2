import { execSync } from 'node:child_process';
import path from 'node:path';
import { config as loadEnv } from 'dotenv';

/** Applies migrations to the dedicated test database before the e2e suite. */
export default function setup(): void {
  const apiDir = path.join(import.meta.dirname, '..');
  loadEnv({ path: path.join(apiDir, '..', '..', '.env'), quiet: true });
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error('DATABASE_URL_TEST não definido no .env');

  execSync('npx prisma migrate deploy', {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
