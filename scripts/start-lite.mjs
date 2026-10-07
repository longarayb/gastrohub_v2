// `pnpm start:lite`: lightest way to use the app on a low-memory machine.
// Production builds (no watchers, no hot reload): API (3333) + admin panel (3000).
// `pnpm start:lite --menu` also starts the digital menu (3001).
// Rebuilds only what changed (Turborepo cache). Stop with Ctrl+C.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { ensureDocker, ensureEnvFile, infraUp, log, root, run } from './lib.mjs';

const withMenu = process.argv.includes('--menu');

ensureEnvFile();
ensureDocker();
infraUp();

log('Aplicando migrations pendentes...');
run('pnpm', ['--filter', '@app/api', 'db:deploy']);

log(`Compilando API, painel${withMenu ? ' e cardápio digital' : ''} (só o que mudou)...`);
run('pnpm', [
  'turbo',
  'run',
  'build',
  '--filter=@app/api',
  '--filter=@app/web',
  ...(withMenu ? ['--filter=@app/menu'] : []),
  '--concurrency=2',
]);

/** The standalone server does not include static assets; copy them next to it. */
function standaloneOf(app) {
  const dir = path.join(root, 'apps', app);
  const standalone = path.join(dir, '.next', 'standalone', 'apps', app);
  rmSync(path.join(standalone, '.next', 'static'), { recursive: true, force: true });
  cpSync(path.join(dir, '.next', 'static'), path.join(standalone, '.next', 'static'), {
    recursive: true,
  });
  if (existsSync(path.join(dir, 'public'))) {
    cpSync(path.join(dir, 'public'), path.join(standalone, 'public'), { recursive: true });
  }
  return standalone;
}

// Next standalone servers do not read the root .env at runtime (secrets such as the menu
// cache refresh): pass it to them; real environment variables take precedence.
const rootEnv = parseEnv(readFileSync(path.join(root, '.env'), 'utf8'));

const next = (app, port) =>
  spawn('node', ['server.js'], {
    cwd: standaloneOf(app),
    stdio: 'inherit',
    env: {
      ...rootEnv,
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: 'localhost',
    },
  });

const children = [
  spawn('node', ['dist/main.js'], {
    cwd: path.join(root, 'apps', 'api'),
    stdio: 'inherit',
  }),
  next('web', 3000),
  ...(withMenu ? [next('menu', 3001)] : []),
];
log(
  `Painel: http://localhost:3000${withMenu ? ' · Cardápio: http://localhost:3001/demo' : ''} · API: http://localhost:3333/docs · E-mails: http://localhost:8025`,
);

const stop = () => children.forEach((c) => c.kill('SIGINT'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) {
  child.on('exit', (code) => {
    stop();
    process.exit(code ?? 0);
  });
}
