// `pnpm start:lite`: lightest way to use the app on a low-memory machine.
// Production builds (no watchers, no hot reload): API (3333) + admin panel (3000).
// Rebuilds only what changed (Turborepo cache). Stop with Ctrl+C.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ensureDocker, ensureEnvFile, infraUp, log, root, run } from './lib.mjs';

ensureEnvFile();
ensureDocker();
infraUp();

log('Aplicando migrations pendentes...');
run('pnpm', ['--filter', '@app/api', 'db:deploy']);

log('Compilando API e painel (só o que mudou)...');
run('pnpm', ['turbo', 'run', 'build', '--filter=@app/api', '--filter=@app/web', '--concurrency=2']);

// The standalone server does not include static assets; copy them next to it.
const web = path.join(root, 'apps', 'web');
const standalone = path.join(web, '.next', 'standalone', 'apps', 'web');
rmSync(path.join(standalone, '.next', 'static'), { recursive: true, force: true });
cpSync(path.join(web, '.next', 'static'), path.join(standalone, '.next', 'static'), {
  recursive: true,
});
if (existsSync(path.join(web, 'public'))) {
  cpSync(path.join(web, 'public'), path.join(standalone, 'public'), { recursive: true });
}

const children = [
  spawn('node', ['dist/main.js'], {
    cwd: path.join(root, 'apps', 'api'),
    stdio: 'inherit',
  }),
  spawn('node', ['server.js'], {
    cwd: standalone,
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'production', PORT: '3000', HOSTNAME: 'localhost' },
  }),
];
log(
  'Painel: http://localhost:3000 · API: http://localhost:3333/docs · E-mails: http://localhost:8025',
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
