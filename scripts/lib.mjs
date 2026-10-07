// Cross-platform helpers for the dev scripts (Windows PowerShell, Git Bash, macOS, Linux).
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const log = (msg) => console.log(`\x1b[36m[app]\x1b[0m ${msg}`);
export const fail = (msg) => {
  console.error(`\x1b[31m[app]\x1b[0m ${msg}`);
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

/**
 * IPv4 address of this machine on the local network (Wi-Fi/Ethernet), for testing on a phone.
 * Prefers private ranges (192.168, 10, 172.16–31); skips virtual adapters (WSL, Docker, VPN).
 */
export function lanAddress() {
  const isPrivate = (ip) =>
    /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  const virtual = /vethernet|wsl|docker|hyper-v|virtual|vmware|vbox|loopback|tailscale|zerotier/i;
  const candidates = Object.entries(os.networkInterfaces())
    .filter(([name]) => !virtual.test(name))
    .flatMap(([, list]) => list ?? [])
    .filter((a) => a.family === 'IPv4' && !a.internal && isPrivate(a.address))
    .map((a) => a.address);
  return candidates.find((ip) => ip.startsWith('192.168.')) ?? candidates[0] ?? null;
}

/** Links of the apps for a phone on the same network. */
export function lanLinks(ip) {
  return {
    panel: `http://${ip}:3000`,
    menu: `http://${ip}:3001/demo`,
    api: `http://${ip}:3333`,
  };
}

/**
 * `--lan`: phones on the same Wi-Fi reach the apps by the machine IP. The browser apps get it
 * at build/compile time (inlined in the bundles) and the API allows it (CORS, links of uploaded
 * images). Returns the IP, or fails when the machine has no local network address.
 */
export function applyLanEnv() {
  const ip = lanAddress();
  if (!ip) fail('Não encontrei um IP de rede local (Wi-Fi ou cabo) para o modo --lan.');
  const links = lanLinks(ip);
  Object.assign(process.env, {
    NEXT_PUBLIC_API_URL: links.api,
    NEXT_PUBLIC_MENU_URL: `http://${ip}:3001`,
    API_PUBLIC_URL: links.api,
    WEB_PUBLIC_URL: links.panel,
    MENU_PUBLIC_URL: `http://${ip}:3001`,
    API_CORS_ORIGINS: [
      'http://localhost:3000',
      'http://localhost:3001',
      links.panel,
      `http://${ip}:3001`,
    ].join(','),
  });
  return ip;
}

export function logLanLinks(ip, withMenu = true) {
  const links = lanLinks(ip);
  log(
    `No celular (mesma rede Wi-Fi): painel ${links.panel}${withMenu ? ` · cardápio ${links.menu}` : ''}`,
  );
  log('Se não abrir no celular, veja "Testar no celular" no docs/SETUP.md (firewall do Windows).');
}
