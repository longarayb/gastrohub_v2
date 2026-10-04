import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import type { NextConfig } from 'next';

// The monorepo keeps a single .env at the repository root.
loadEnvConfig(path.join(import.meta.dirname, '..', '..'));

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
