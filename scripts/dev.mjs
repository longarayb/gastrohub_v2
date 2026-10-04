// `pnpm dev`: starts the Docker infrastructure, applies pending migrations and runs every app in watch mode.
import { ensureDocker, ensureEnvFile, infraUp, log, run, runForever } from './lib.mjs';

ensureEnvFile();
ensureDocker();
infraUp();

log('Aplicando migrations pendentes...');
run('pnpm', ['--filter', '@app/api', 'db:deploy']);

log('Iniciando apps: api (3333), web (3000), menu (3001)...');
runForever('pnpm', ['dev:apps']);
