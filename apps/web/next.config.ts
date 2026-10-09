import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// The monorepo keeps a single .env at the repository root. Next already loaded the env of
// apps/web (none) and @next/env caches it: force the reload from the root.
loadEnvConfig(path.join(import.meta.dirname, '..', '..'), undefined, undefined, true);

// Next collects NEXT_PUBLIC_* before this file runs, so the values of the root .env would not
// be inlined in the browser code: pass them explicitly (the process environment, e.g.
// `start:lite --lan`, still wins over the file).
const publicEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[0].startsWith('NEXT_PUBLIC_') && entry[1] !== undefined,
  ),
);

const nextConfig: NextConfig = {
  env: publicEnv,
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
  transpilePackages: ['@app/ui'],
  // Few build workers by default: dev machines with a small page file run out of commit memory.
  experimental: { cpus: Number(process.env.NEXT_BUILD_CPUS) || 2 },
  typedRoutes: true,
  images: {
    remotePatterns: [{ protocol: 'http', hostname: 'localhost' }],
  },
};

export default nextConfig;
