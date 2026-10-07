import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { expand } from 'dotenv-expand';
import pg from 'pg';

// e2e tests run against the dedicated test database.
expand(loadEnv({ path: path.join(import.meta.dirname, '..', '..', '..', '.env'), quiet: true }));
process.env.NODE_ENV = 'test';
// Suites create many accounts quickly; throttle.e2e.test.ts re-enables it.
process.env.THROTTLE_DISABLED = 'true';
// Never call the real geocoder from tests (addresses carry coordinates when a test needs them).
process.env.GEOCODING_PROVIDER = 'none';
// No calls to the menu app from tests (its cache refresh is fire-and-forget).
process.env.MENU_REVALIDATE_SECRET = '';
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

// Two queries at once on one pg connection (Promise.all or an unawaited query inside
// $transaction, or a read with several relations inside a transaction): pg 8 only warns once
// per process and pg 9 will throw. Fail the test that did it, with the SQL of both queries.
// Fix: sequential queries; reads with several relations use findFirstSequential.
const sqlOf = (query: unknown) =>
  String((query as { text?: string } | null)?.text ?? query ?? '')
    .replace(/\s+/g, ' ')
    .slice(0, 160);
type QueuedClient = { _queryQueue?: unknown[]; activeQuery?: unknown; pipeline?: boolean };
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function (this: QueuedClient, ...args: unknown[]) {
  const queued = this._queryQueue ?? [];
  if (queued.length > 0 && !this.pipeline) {
    record(
      new Error(
        'Consultas em paralelo na mesma conexão do Postgres:\n' +
          `  em andamento: ${sqlOf(this.activeQuery ?? queued[0])}\n` +
          `  nova: ${sqlOf(args[0])}`,
      ),
    );
  }
  return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
} as typeof pg.Client.prototype.query;
process.on('warning', (warning) => {
  if (warning.name === 'DeprecationWarning' && /client\.query\(\)/.test(warning.message)) {
    record(warning);
  }
});

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
