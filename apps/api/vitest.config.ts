import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// SWC is required so Vitest emits decorator metadata used by NestJS dependency injection.
// `.swcrc` excludes test files from the build, so the test transform has its own options.
const swcPlugin = swc.vite({
  swcrc: false,
  module: { type: 'es6' },
  jsc: {
    parser: { syntax: 'typescript', decorators: true },
    transform: { legacyDecorator: true, decoratorMetadata: true, useDefineForClassFields: false },
    target: 'es2023',
    keepClassNames: true,
  },
});

export default defineConfig({
  plugins: [swcPlugin],
  test: {
    globals: true,
    environment: 'node',
    projects: [
      {
        plugins: [swcPlugin],
        test: {
          name: 'unit',
          globals: true,
          include: ['src/**/*.test.ts'],
        },
      },
      {
        plugins: [swcPlugin],
        test: {
          name: 'e2e',
          globals: true,
          include: ['test/**/*.e2e.test.ts'],
          setupFiles: ['test/setup-env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
