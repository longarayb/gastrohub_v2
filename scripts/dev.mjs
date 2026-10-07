// `pnpm dev`: starts the Docker infrastructure, applies pending migrations and runs every app in watch mode.
// `pnpm dev --lan`: same, reachable from a phone on the same Wi-Fi (see docs/SETUP.md).
import {
  applyLanEnv,
  ensureDocker,
  ensureEnvFile,
  infraUp,
  log,
  logLanLinks,
  run,
  runForever,
} from './lib.mjs';

const ip = process.argv.includes('--lan') ? applyLanEnv() : null;

ensureEnvFile();
ensureDocker();
infraUp();

log('Aplicando migrations pendentes...');
run('pnpm', ['--filter', '@app/api', 'db:deploy']);

log('Iniciando apps: api (3333), web (3000), menu (3001)...');
if (ip) logLanLinks(ip);
runForever('pnpm', ['dev:apps']);
