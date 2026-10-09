import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// The monorepo keeps a single .env at the repository root. Next already loaded the env of
// apps/menu (none) and @next/env caches it: force the reload from the root, otherwise
// MENU_REVALIDATE_SECRET never reaches the server and every refresh asked by the API is refused.
loadEnvConfig(path.join(import.meta.dirname, '..', '..'), undefined, undefined, true);

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '..', '..'),
  transpilePackages: ['@app/ui'],
  // Few build workers by default: dev machines with a small page file run out of commit memory.
  experimental: { cpus: Number(process.env.NEXT_BUILD_CPUS) || 2 },
  images: {
    remotePatterns: [{ protocol: 'http', hostname: 'localhost' }],
  },
};

export default nextConfig;
