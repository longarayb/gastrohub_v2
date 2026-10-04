// `pnpm bootstrap`: first-time setup — .env, infrastructure, database schema and demo data.
import { ensureDocker, ensureEnvFile, infraUp, log, run } from './lib.mjs';

ensureEnvFile();
ensureDocker();
infraUp();

log('Gerando Prisma Client e aplicando migrations...');
run('pnpm', ['--filter', '@gastrohub/api', 'db:deploy']);

log('Compilando pacotes compartilhados...');
run('pnpm', ['turbo', 'run', 'build', '--filter=./packages/*']);

log('Populando dados de demonstração (seed)...');
run('pnpm', ['--filter', '@gastrohub/api', 'db:seed']);

log('Pronto! Rode `pnpm dev` e acesse http://localhost:3000');
