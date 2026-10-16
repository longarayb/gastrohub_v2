import { defineConfig } from 'vitest/config';

// Pure modules of the app (queue, server address, battery guides); screens run on the phone.
export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
