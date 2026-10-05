import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { expand } from 'dotenv-expand';
import { defineConfig } from 'prisma/config';

// The monorepo keeps a single .env at the repository root.
expand(loadEnv({ path: path.join(import.meta.dirname, '..', '..', '.env'), quiet: true }));

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),
  migrations: {
    path: path.join('prisma', 'migrations'),
    seed: 'tsx prisma/seed/index.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
