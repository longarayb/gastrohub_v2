// Cross-platform helpers for the dev scripts (Windows PowerShell, Git Bash, macOS, Linux).
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const log = (msg) => console.log(`\x1b[36m[gastrohub]\x1b[0m ${msg}`);
export const fail = (msg) => {
  console.error(`\x1b[31m[gastrohub]\x1b[0m ${msg}`);
  process.exit(1);
};

/** Runs a command synchronously, inheriting stdio. Exits on failure. */
export function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true, ...opts });
  if (result.status !== 0) fail(`Falha ao executar: ${cmd} ${args.join(' ')}`);
}

/** Runs a long-lived command and forwards signals. */
export function runForever(cmd, args) {
  const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell: true });
  const stop = () => child.kill('SIGINT');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}

export function ensureEnvFile() {
  const env = path.join(root, '.env');
  if (!existsSync(env)) {
    copyFileSync(path.join(root, '.env.example'), env);
    log('Arquivo .env criado a partir do .env.example');
  }
}

export function ensureDocker() {
  const result = spawnSync('docker', ['info'], { stdio: 'ignore', shell: true });
  if (result.status !== 0) {
    fail('Docker não está rodando. Abra o Docker Desktop e tente novamente.');
  }
}

export function infraUp() {
  log('Subindo Postgres, Redis e Mailpit (docker compose)...');
  run('docker', ['compose', 'up', '-d', '--wait', 'postgres', 'redis', 'mailpit']);
}
