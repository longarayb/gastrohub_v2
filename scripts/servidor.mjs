// Temporary server of the home network on the Surface (docs/SETUP.md, "Servidor temporário no
// Surface"). Runs inside WSL. Everything lives in ~/servidor (SERVIDOR_DIR), apart from the
// development folder: changing branch where you program never changes what the server runs.
//
//   pnpm servidor:subir [--mesmo-assim]   starts it (first time: clones, builds, migrates, Demo)
//   pnpm servidor:parar                   stops it (data kept)
//   pnpm servidor:atualizar               pull of main, production build, migrations, restart
//   pnpm servidor:status                  version, health, memory
//   pnpm servidor:logs [api|web|...]      follows the logs
//   pnpm servidor:demo                    restores the Demo (demo-reset)
//   pnpm servidor:admin create --email <e-mail> --name "<nome>"   platform admins (the CLI)
//   pnpm servidor:tunel [painel|cardapio] temporary https address (courier GPS on a phone)
//   pnpm servidor:apk [arquivo.apk]       publishes the courier app APK (the app offers the update)
//
// Production images built locally (local/app-*:<commit>) and deploy/compose.prod.yml with
// deploy/home/compose.home.yml (project "servidor": own Postgres, Redis, Mailpit and volumes;
// the database port is not published, so development seed and e2e cannot reach it).
import { generateKeyPairSync } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fail, lanAddress, log } from './lib.mjs';

const HOME = process.env.SERVIDOR_DIR ?? path.join(os.homedir(), 'servidor');
const REPO = path.join(HOME, 'GastroHub_v2');
const ENV = path.join(HOME, '.env');
const DATA = path.join(HOME, 'dados');
const BACKUPS = path.join(HOME, 'backups');
// Only to test these scripts themselves before a merge (another folder, another branch); the
// server always runs main.
const REPO_URL = process.env.SERVIDOR_REPO ?? 'https://github.com/longarayb/gastrohub_v2.git';
const BRANCH = process.env.SERVIDOR_BRANCH ?? 'main';
const PROJECT = process.env.SERVIDOR_PROJETO ?? 'servidor';
const APPS = ['api', 'web', 'menu', 'admin'];
const PG = `${PROJECT}-postgres-1`;

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name);

if (process.platform !== 'linux') {
  fail('O servidor roda dentro do WSL (Ubuntu): abra o terminal do Ubuntu e rode lá.');
}

// ---------------------------------------------------------------------------------------------
// Helpers

function sh(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (result.status !== 0 && !opts.allowFail) fail(`Falhou: ${cmd} ${args.join(' ')}`);
  return result.status === 0;
}
function out(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  return result.status === 0 ? result.stdout.trim() : '';
}
const compose = (...args) => [
  'compose',
  '--progress',
  'quiet',
  '--project-name',
  PROJECT,
  '-f',
  path.join(HOME, 'compose.prod.yml'),
  '-f',
  path.join(HOME, 'compose.home.yml'),
  '--env-file',
  ENV,
  ...args,
];
const dc = (args, opts) => sh('docker', compose(...args), opts);

function readEnv() {
  if (!existsSync(ENV)) return {};
  return Object.fromEntries(
    readFileSync(ENV, 'utf8')
      .split('\n')
      .map((l) => /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );
}
function setEnv(values) {
  let text = readFileSync(ENV, 'utf8');
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, 'm');
    text = re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`;
  }
  writeFileSync(ENV, text, { mode: 0o600 });
}

function ensureDocker() {
  if (!sh('docker', ['info'], { stdio: 'ignore', allowFail: true })) {
    fail('Docker não está rodando. Abra o Docker Desktop no Windows e tente de novo.');
  }
}

/** What of the development environment is running (it shares ports and memory). */
function developmentRunning() {
  const procs = out('pgrep', [
    '-af',
    'start-lite.mjs|scripts/dev.mjs|next-server|apps/(web|menu|admin)/.next|apps/api/dist/main.js|nest start|turbo run dev',
  ])
    .split('\n')
    .filter((l) => l && !l.includes('servidor.mjs') && !l.includes('pgrep'));
  const containers = out('docker', [
    'ps',
    '--filter',
    'label=com.docker.compose.project=app',
    '--format',
    '{{.Names}}',
  ])
    .split('\n')
    .filter(Boolean);
  return { procs, containers };
}

function checkDevelopment() {
  const { procs, containers } = developmentRunning();
  if (!procs.length && !containers.length) return;
  const what = [
    procs.length
      ? `servidores de desenvolvimento (${procs.length} processo(s) do pnpm dev/start:lite)`
      : '',
    containers.length ? `containers do desenvolvimento (${containers.join(', ')})` : '',
  ]
    .filter(Boolean)
    .join(' e ');
  const message =
    `O ambiente de desenvolvimento está rodando: ${what}.\n` +
    '  Com 8 GB, o servidor e o desenvolvimento não cabem juntos (e usam as mesmas portas).\n' +
    '  Pare o desenvolvimento (Ctrl+C no pnpm dev/start:lite e pnpm infra:down) e rode de novo.';
  if (flag('--mesmo-assim')) log(`AVISO: ${message}`);
  else fail(`${message}\n  Para subir assim mesmo: pnpm servidor:subir --mesmo-assim`);
}

function ensureRepo() {
  mkdirSync(HOME, { recursive: true });
  if (!existsSync(path.join(REPO, '.git'))) {
    log(`Primeira vez: clonando a ${BRANCH} em ${REPO}...`);
    sh('git', ['clone', '--branch', BRANCH, REPO_URL, REPO]);
  }
}

/** Compose files and the Caddyfile of the version in the server folder. */
function syncFiles() {
  copyFileSync(path.join(REPO, 'deploy/compose.prod.yml'), path.join(HOME, 'compose.prod.yml'));
  copyFileSync(
    path.join(REPO, 'deploy/home/compose.home.yml'),
    path.join(HOME, 'compose.home.yml'),
  );
  copyFileSync(path.join(REPO, 'deploy/home/Caddyfile.home'), path.join(HOME, 'Caddyfile.home'));
}

function ensureNetwork() {
  if (!sh('docker', ['network', 'inspect', 'app_net'], { stdio: 'ignore', allowFail: true })) {
    sh('docker', [
      'network',
      'create',
      '--subnet',
      '172.30.0.0/24',
      '--gateway',
      '172.30.0.1',
      'app_net',
    ]);
  }
}

/** .env of the server: secrets generated once (gen-secrets.sh); addresses from the current IP. */
function ensureEnv(ip) {
  mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
  mkdirSync(BACKUPS, { recursive: true });
  if (!existsSync(ENV)) {
    log('Primeira vez: gerando os segredos do servidor (deploy/gen-secrets.sh)...');
    const gen = spawnSync(
      'bash',
      [path.join(REPO, 'deploy/gen-secrets.sh'), ip, 'servidor@casa.local'],
      {
        env: { ...process.env, TARGET: ENV },
        encoding: 'utf8',
      },
    );
    if (gen.status !== 0) fail(`gen-secrets falhou:\n${gen.stderr}`);
    setEnv({
      IMAGE_PREFIX: 'local',
      DATABASE_URL: readEnv().DATABASE_URL.replace('@172.30.0.1:5432', '@postgres:5432'),
      DATABASE_URL_OWNER: readEnv().DATABASE_URL_OWNER.replace(
        '@172.30.0.1:5432',
        '@postgres:5432',
      ),
      POSTGRES_SUPERUSER_PASSWORD: spawnSync('openssl', ['rand', '-hex', '24'], {
        encoding: 'utf8',
      }).stdout.trim(),
      SMTP_USER: '',
      SMTP_PASSWORD: '',
      MAIL_FROM_ADDRESS: 'nao-responda@servidor.local',
      NOMINATIM_EMAIL: '',
      BACKUP_AGE_RECIPIENT: '',
      BACKUP_REMOTE: '',
      HC_BACKUP_URL: '',
      HC_MONITOR_URL: '',
      DEMO_RESET_ENABLED: 'true',
    });
  }
  // Web Push keys (D049) for a server installed before them; generated once, kept after.
  const vapid = readEnv().VAPID_PUBLIC_KEY;
  if (!vapid || vapid === '<gerado>') {
    const jwk = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey.export({
      format: 'jwk',
    });
    const pub = Buffer.concat([
      Buffer.from([4]),
      Buffer.from(jwk.x, 'base64url'),
      Buffer.from(jwk.y, 'base64url'),
    ]);
    setEnv({ VAPID_PUBLIC_KEY: pub.toString('base64url'), VAPID_PRIVATE_KEY: jwk.d });
    log('Chaves de push (VAPID) criadas no .env do servidor.');
  }
  // Firebase (D050): the service account saved by the owner goes to the .env once (base64).
  const firebase = path.join(os.homedir(), '.config', 'app-courier', 'firebase-service-account.json');
  if (existsSync(firebase) && !readEnv().FCM_SERVICE_ACCOUNT) {
    setEnv({ FCM_SERVICE_ACCOUNT: readFileSync(firebase).toString('base64') });
    log('Firebase: conta de serviço adicionada ao .env do servidor (avisos de rota nova no app).');
  }
  // The uploads folder belongs to the node user of the API image.
  sh(
    'docker',
    ['run', '--rm', '-v', `${DATA}/uploads:/u`, 'alpine:3.20', 'chown', '1000:1000', '/u'],
    {
      stdio: 'ignore',
    },
  );
  const previous = readEnv().WEB_PUBLIC_URL;
  setEnv({
    SERVER_DATA: DATA,
    BASE_DOMAIN: ip,
    API_PUBLIC_URL: `http://${ip}:3333`,
    WEB_PUBLIC_URL: `http://${ip}:3000`,
    MENU_PUBLIC_URL: `http://${ip}:3001`,
    ADMIN_PUBLIC_URL: `http://${ip}:3002`,
    API_CORS_ORIGINS: [3000, 3001, 3002].map((p) => `http://${ip}:${p}`).join(','),
  });
  if (previous && previous !== `http://${ip}:3000`) {
    log(
      `O IP do Surface mudou (${previous} → http://${ip}:3000). Reserve um IP fixo no roteador (docs/SETUP.md).`,
    );
  }
}

const imagesExist = (version) =>
  APPS.every((app) =>
    sh('docker', ['image', 'inspect', `local/app-${app}:${version}`], {
      stdio: 'ignore',
      allowFail: true,
    }),
  );

function build(version) {
  const logFile = path.join(HOME, 'build.log');
  writeFileSync(logFile, '');
  for (const app of APPS) {
    const started = Date.now();
    log(`Montando ${app} (${version}) em modo produção... (log em ${logFile})`);
    const file = app === 'api' ? 'docker/api.Dockerfile' : 'docker/next.Dockerfile';
    const result = spawnSync(
      'bash',
      [
        '-c',
        `docker build -f ${file} --build-arg APP=${app} --build-arg NEXT_PUBLIC_API_URL= ` +
          `--build-arg NEXT_PUBLIC_MENU_URL= --build-arg NEXT_BUILD_CPUS=1 ` +
          `-t local/app-${app}:${version} . >> "${logFile}" 2>&1`,
      ],
      { cwd: REPO, stdio: 'inherit' },
    );
    if (result.status !== 0) fail(`O build de ${app} falhou: veja ${logFile}`);
    log(`  ${app} pronto em ${Math.round((Date.now() - started) / 1000)} s`);
  }
}

/** Database users and permissions (idempotent: also fixes the grants after a restore). */
function dbSetup() {
  dc(['up', '-d', '--wait', 'postgres', 'redis', 'mailpit']);
  sh('bash', [path.join(REPO, 'deploy/db-setup.sh')], {
    env: { ...process.env, ENV_FILE: ENV, PSQL: `docker exec -i ${PG} psql -U postgres` },
  });
}

const psql = (sql) =>
  out('docker', ['exec', PG, 'psql', '-U', 'postgres', '-d', 'app_db', '-tAc', sql]);

function backupBeforeMigrations(version) {
  if (psql('SELECT count(*) FROM "Store"') === '') return; // empty database (first time)
  const file = path.join(
    BACKUPS,
    `antes-de-${version}-${new Date().toISOString().replace(/[:.]/g, '')}.dump`,
  );
  sh('bash', ['-c', `docker exec ${PG} pg_dump -U postgres -Fc app_db > "${file}"`]);
  sh('bash', ['-c', `ls -1t "${BACKUPS}"/*.dump | tail -n +6 | xargs -r rm -f`]);
  log(`Backup do banco antes das migrations: ${file}`);
}

const URLS = () => [
  ['API', 'http://localhost:3333/api/health'],
  ['Painel', 'http://localhost:3000/login'],
  ['API pelo painel', 'http://localhost:3000/api/health'],
  ['Cardápio', 'http://localhost:3001/robots.txt'],
  ['Admin', 'http://localhost:3002/login'],
];

async function health(timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let failed = [];
  while (Date.now() < deadline) {
    failed = [];
    for (const [name, url] of URLS()) {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (!res?.ok) failed.push(`${name} (${res?.status ?? 'sem resposta'})`);
    }
    if (!failed.length) return true;
    await new Promise((r) => setTimeout(r, 3000));
  }
  log(`Sem resposta: ${failed.join(', ')}`);
  return false;
}

function versionLine() {
  const env = readEnv();
  const commit = out('git', [
    '-C',
    REPO,
    'log',
    '-1',
    '--format=%h · %ad · %s',
    '--date=format:%d/%m %H:%M',
    env.APP_VERSION || 'HEAD',
  ]);
  return `${env.APP_VERSION || '(nenhuma)'}${commit ? ` (${commit})` : ''}`;
}

function addresses(ip) {
  console.log(`
  Servidor no ar — versão ${versionLine()}

  Neste Surface e em outro computador ou celular da rede de casa:
    Painel do restaurante   http://${ip}:3000
    Cardápio digital (Demo) http://${ip}:3001/demo
    Painel da plataforma    http://${ip}:3002
    API e agente de impressão  http://${ip}:3333/api
  E-mails do servidor (só neste Surface): http://localhost:8026

  Demo: dono@demo.local / Demo1234 (modo demonstração: restaurar com pnpm servidor:demo).
  GPS do entregador no celular precisa de https: pnpm servidor:tunel
`);
}

function currentIp() {
  const ip = lanAddress();
  if (!ip)
    fail('Sem IP da rede de casa (Wi-Fi ou cabo). Conecte o Surface à rede e tente de novo.');
  return ip;
}

async function ensureDemo() {
  if (psql(`SELECT count(*) FROM "Store" WHERE slug = 'demo'`) === '0') {
    log('Primeira vez: criando a Demo (demo-reset)...');
    dc(['run', '--rm', '--no-deps', 'api', 'node', 'dist/cli/demo-reset.js', '--yes']);
  }
}

// ---------------------------------------------------------------------------------------------
// Commands

async function atualizar() {
  ensureDocker();
  checkDevelopment();
  ensureRepo();
  if (out('git', ['-C', REPO, 'status', '--porcelain'])) {
    fail(
      `A pasta do servidor (${REPO}) tem mudanças locais: ela é só para a main. Desfaça-as antes.`,
    );
  }
  log(`Baixando a ${BRANCH}...`);
  sh('git', ['-C', REPO, 'fetch', '--quiet', 'origin', BRANCH]);
  sh('git', ['-C', REPO, 'checkout', '--quiet', BRANCH]);
  sh('git', ['-C', REPO, 'merge', '--ff-only', '--quiet', `origin/${BRANCH}`]);
  const version = out('git', ['-C', REPO, 'rev-parse', '--short=7', 'HEAD']);
  const previous = readEnv().APP_VERSION;
  if (version === previous && imagesExist(version) && (await health(5000))) {
    log(`Já está na versão ${versionLine()}: nada a atualizar.`);
    return;
  }
  if (!imagesExist(version)) build(version);
  syncFiles();
  ensureNetwork();
  const ip = currentIp();
  ensureEnv(ip);
  dbSetup();
  backupBeforeMigrations(version);
  setEnv({ APP_VERSION: version });
  log('Aplicando as migrations...');
  dc(['--profile', 'tools', 'run', '--rm', 'migrate']);
  log('Reiniciando com a versão nova...');
  dc(['up', '-d', '--remove-orphans']);
  if (!(await health())) {
    if (previous && previous !== version && imagesExist(previous)) {
      log(`A versão ${version} não respondeu: voltando para ${previous}.`);
      setEnv({ APP_VERSION: previous });
      dc(['up', '-d', '--remove-orphans']);
      await health();
      log(`O backup feito antes das migrations está em ${BACKUPS}.`);
    }
    fail('Atualização com problema: veja pnpm servidor:logs api');
  }
  await ensureDemo();
  // Keeps the images of this version and the previous one (to go back).
  for (const app of APPS) {
    const tags = out('docker', ['images', `local/app-${app}`, '--format', '{{.Tag}}']).split('\n');
    for (const tag of tags) {
      if (tag && tag !== version && tag !== previous && tag !== 'test') {
        sh('docker', ['rmi', `local/app-${app}:${tag}`], { stdio: 'ignore', allowFail: true });
      }
    }
  }
  addresses(ip);
}

async function subir() {
  ensureDocker();
  checkDevelopment();
  ensureRepo();
  const version = readEnv().APP_VERSION;
  if (!version || !imagesExist(version)) {
    log(`Nenhuma versão montada ainda: atualizando a partir da ${BRANCH} (alguns minutos)...`);
    return atualizar();
  }
  syncFiles();
  ensureNetwork();
  const ip = currentIp();
  ensureEnv(ip);
  dbSetup();
  dc(['up', '-d', '--remove-orphans']);
  if (!(await health())) fail('O servidor não respondeu: veja pnpm servidor:logs');
  await ensureDemo();
  addresses(ip);
}

function parar() {
  ensureDocker();
  if (!existsSync(ENV)) fail('O servidor ainda não foi instalado (pnpm servidor:subir).');
  // `down` (never `-v`): stopped containers with a restart policy came back after a Docker
  // restart and took the development ports; the volumes (database, Redis) stay.
  dc(['down']);
  log('Servidor parado. Banco, Redis e imagens enviadas continuam guardados.');
}

async function status() {
  ensureDocker();
  if (!existsSync(ENV)) fail('O servidor ainda não foi instalado (pnpm servidor:subir).');
  const ip = lanAddress();
  console.log(`\n  Versão: ${versionLine()}`);
  const running = out('docker', compose('ps', '--format', '{{.Service}}\t{{.State}}\t{{.Status}}'));
  console.log(
    `\n  Serviços:\n${
      running
        ? running
            .split('\n')
            .map((l) => `    ${l.replace(/\t/g, '  ')}`)
            .join('\n')
        : '    (nenhum rodando)'
    }`,
  );
  console.log('\n  No ar:');
  for (const [name, url] of URLS()) {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) }).catch(() => null);
    console.log(`    ${res?.ok ? 'ok  ' : 'NÃO '} ${name}`);
  }
  const stats = out('docker', [
    'stats',
    '--no-stream',
    '--format',
    '{{.Name}}\t{{.MemUsage}}',
    ...out('docker', [
      'ps',
      '--filter',
      `label=com.docker.compose.project=${PROJECT}`,
      '--format',
      '{{.Names}}',
    ])
      .split('\n')
      .filter(Boolean),
  ]);
  console.log(
    `\n  Memória dos containers:\n${
      stats
        ? stats
            .split('\n')
            .map((l) => `    ${l.replace(`${PROJECT}-`, '').replace('\t', '  ')}`)
            .join('\n')
        : '    —'
    }`,
  );
  const free = out('free', ['-m']).split('\n')[1]?.split(/\s+/);
  if (free)
    console.log(
      `  WSL (Linux + Docker): ${free[2]} MB em uso de ${free[1]} MB; disponíveis ${free[6]} MB`,
    );
  if (ip)
    console.log(
      `\n  Endereços: painel http://${ip}:3000 · cardápio http://${ip}:3001/demo · admin http://${ip}:3002\n`,
    );
}

function logs() {
  ensureDocker();
  dc(['logs', '-f', '--tail', '200', ...rest.filter((a) => !a.startsWith('--'))], {
    allowFail: true,
  });
}

/**
 * Platform admins of the server (the Demo has none: demo-reset never creates one). Same CLI as in
 * production: create (temporary password, 2FA on first login), reset-password, reset-2fa.
 */
function admin() {
  ensureDocker();
  const args = rest.filter((a) => a !== '--');
  if (!args.length) {
    fail(
      'Uso: pnpm servidor:admin create --email <e-mail> --name "<nome>"\n' +
        '     pnpm servidor:admin reset-password --email <e-mail> --reason "<motivo>"\n' +
        '     pnpm servidor:admin reset-2fa --email <e-mail> --reason "<motivo>"',
    );
  }
  dc(['run', '--rm', '--no-deps', 'api', 'node', 'dist/cli/platform-admin.js', ...args]);
}

function demo() {
  ensureDocker();
  dc(['run', '--rm', '--no-deps', 'api', 'node', 'dist/cli/demo-reset.js', '--yes']);
}

async function tunel() {
  const target = rest.includes('cardapio') ? 'cardapio' : 'painel';
  const port = target === 'cardapio' ? 3001 : 3000;
  const i = rest.indexOf('--minutos');
  const minutes = Math.min(Math.max(Number(rest[i + 1]) || 30, 1), 120);
  // WSL inherits the Windows PATH only when it starts: also the winget install folders.
  const bin = [
    'cloudflared',
    'cloudflared.exe',
    '/mnt/c/Program Files (x86)/cloudflared/cloudflared.exe',
    '/mnt/c/Program Files/cloudflared/cloudflared.exe',
  ].find((b) => spawnSync(b, ['--version'], { stdio: 'ignore' }).status === 0);
  if (!bin) {
    fail(
      'cloudflared não está instalado. No PowerShell do Windows (uma vez):\n' +
        '    winget install --id Cloudflare.cloudflared\n' +
        '  e abra um terminal novo do Ubuntu.',
    );
  }
  const res = await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(5000) }).catch(
    () => null,
  );
  if (!res) fail('O servidor não está no ar: pnpm servidor:subir');
  console.log(`
  ⚠  ATENÇÃO: o túnel deixa o ${target === 'painel' ? 'painel do restaurante' : 'cardápio digital'} DO SERVIDOR DE CASA
     acessível por qualquer pessoa na internet enquanto estiver aberto (as senhas da Demo são
     conhecidas). Use só para testar e feche logo depois. Ele se encerra sozinho em ${minutes}
     minuto(s). Nunca use com dados reais.
`);
  // No shell: killing a shell would leave cloudflared (and the tunnel) running.
  const tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`]);
  let printed = false;
  const onOutput = (chunk) => {
    const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk))?.[0];
    if (url && !printed) {
      printed = true;
      log(`Endereço temporário (https): ${url}${target === 'cardapio' ? '/demo' : ''}`);
      if (target === 'painel') {
        console.log(`
  Entregador no celular: abra ${url}/entregas e entre com entregador@demo.local / Demo1234.
  O navegador só libera a localização (GPS) em https, por isso o túnel.
`);
      }
    }
  };
  tunnel.stdout.on('data', onOutput);
  tunnel.stderr.on('data', onOutput);
  const stop = (reason) => {
    log(reason);
    tunnel.kill('SIGINT');
    setTimeout(() => process.exit(0), 1500).unref();
  };
  const timer = setTimeout(
    () => stop(`Tempo esgotado (${minutes} min): túnel encerrado.`),
    minutes * 60_000,
  );
  process.on('SIGINT', () => stop('Túnel encerrado.'));
  process.on('SIGTERM', () => stop('Túnel encerrado.'));
  tunnel.on('exit', () => {
    clearTimeout(timer);
    process.exit(0);
  });
}

/**
 * Publishes the courier app APK (D050): the newest of apps/courier/dist (or the file given) goes
 * to the server's uploads with latest.json; the app on the phones offers the download.
 */
function apk() {
  const app = path.join(import.meta.dirname, '..', 'apps', 'courier');
  const release = JSON.parse(readFileSync(path.join(app, 'release.json'), 'utf8'));
  let file = rest.find((r) => r.endsWith('.apk'));
  if (!file) {
    const dist = path.join(app, 'dist');
    const apks = existsSync(dist)
      ? readdirSync(dist)
          .filter((f) => f.endsWith('.apk'))
          .map((f) => path.join(dist, f))
          .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      : [];
    file = apks[0];
  }
  if (!file || !existsSync(file)) fail('Nenhum APK: pnpm --filter @app/courier apk');
  const target = path.join(DATA, 'uploads', 'courier-app');
  mkdirSync(target, { recursive: true });
  const name = `entregas-${release.versionCode}.apk`;
  copyFileSync(file, path.join(target, name));
  writeFileSync(
    path.join(target, 'latest.json'),
    JSON.stringify(
      {
        versionCode: release.versionCode,
        versionName: release.versionName,
        notes: release.notes ?? null,
        file: name,
        publishedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  const ip = lanAddress();
  log(`App do entregador ${release.versionName} (${release.versionCode}) publicado.`);
  console.log(`
  Baixar no celular (mesmo Wi-Fi): http://${ip}:3000/api/courier-app/download
  Endereço do servidor para digitar no app: ${ip}:3000
`);
}

const commands = { subir, parar, atualizar, status, logs, demo, admin, tunel, apk };
if (!commands[command]) {
  fail(`Comando desconhecido: ${command ?? '(nenhum)'}. Use: ${Object.keys(commands).join(', ')}`);
}
await commands[command]();
