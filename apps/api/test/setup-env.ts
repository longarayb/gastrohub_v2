import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { expand } from 'dotenv-expand';

// e2e tests run against the dedicated test database.
expand(loadEnv({ path: path.join(import.meta.dirname, '..', '..', '..', '.env'), quiet: true }));
process.env.NODE_ENV = 'test';
// Suites create many accounts quickly; throttle.e2e.test.ts re-enables it.
process.env.THROTTLE_DISABLED = 'true';
// Never call the real geocoder from tests (addresses carry coordinates when a test needs them).
process.env.GEOCODING_PROVIDER = 'none';
if (process.env.DATABASE_URL_TEST) {
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
}

// Errors outside a test's promise chain (fire-and-forget promises, socket and queue
// callbacks). Vitest already fails the run on them; this also fails the test that was
// running (or the file, for teardown errors) and prints the full stack.
const unhandled: { where: string; error: unknown }[] = [];
let where = 'preparação do arquivo (beforeAll)';
const record = (error: unknown) => unhandled.push({ where, error });
process.on('unhandledRejection', record);
process.on('uncaughtException', record);

function failOnUnhandled(): void {
  if (unhandled.length === 0) return;
  const report = unhandled
    .splice(0)
    .map(
      ({ where, error }) => `• ${where}\n${error instanceof Error ? error.stack : String(error)}`,
    )
    .join('\n\n');
  throw new Error(`Erro(s) não tratado(s) durante os testes:\n${report}`);
}

beforeEach((ctx) => {
  where = ctx.task.fullName;
});
afterEach(() => {
  where = 'encerramento do arquivo (afterAll / app.close)';
  failOnUnhandled();
});
afterAll(async () => {
  // Rejections from teardown (app.close) surface a few ticks later.
  await new Promise((resolve) => setTimeout(resolve, 100));
  // Anything later goes back to Vitest's own handler (it still fails the run).
  process.off('unhandledRejection', record);
  process.off('uncaughtException', record);
  failOnUnhandled();
});
