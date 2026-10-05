// `pnpm check`: versioned imports + build, typecheck, lint and unit tests (Turborepo).
// CHECK_CONCURRENCY (environment or root .env, default 2) limits parallel tasks on machines
// with little memory.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { log, root, run } from './lib.mjs';

const envFile = path.join(root, '.env');
// Only this variable is read: loading the whole .env here would pass unexpanded ${VAR}
// values on to the child processes.
const fromFile = existsSync(envFile)
  ? parseEnv(readFileSync(envFile, 'utf8')).CHECK_CONCURRENCY
  : undefined;
const concurrency = Number(process.env.CHECK_CONCURRENCY ?? fromFile) || 2;

run('node', ['scripts/check-tracked-imports.mjs']);
log(`Build, typecheck, lint e testes (concorrência ${concurrency})...`);
run('turbo', ['run', 'build', 'typecheck', 'lint', 'test', `--concurrency=${concurrency}`]);
