// Automatic printing walkthrough (feat/printing) against the production build and a fresh seed.
// Runs the real print agent (apps/print-agent/dist/agent.cjs, `pnpm --filter @app/print-agent
// build`) in virtual mode: every print becomes a text file, checked here.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BROWSER } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'screenshots');
mkdirSync(OUT, { recursive: true });
const WEB = 'http://localhost:3000';
const API = 'http://localhost:3333/api';
const AGENT = path.join(HERE, '..', '..', 'apps', 'print-agent', 'dist', 'agent.cjs');
const AGENT_PORT = 9181;
const DATA = mkdtempSync(path.join(tmpdir(), 'walkthrough-agent-'));
const PRINTS = path.join(DATA, 'impressoes');
const PASSWORD = 'Demo1234';
const results = [];
let page;

const step = async (name, fn) => {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    const lines = e.message.split('\n').slice(0, process.env.DEBUG ? 12 : 1);
    results.push(`FAIL  ${name}: ${lines.join(' | ')} @ ${page.url()}`);
    await page.screenshot({ path: path.join(OUT, `printing-fail-${results.length}.png`) });
  }
};

async function apiLogin(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (await res.json()).accessToken;
}
async function apiCall(token, method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

// ---- The local agent (virtual mode) ----
let agent = null;
const startAgent = () => {
  agent = spawn(
    process.execPath,
    [AGENT, '--virtual', '--api', API, '--data', DATA, '--port', String(AGENT_PORT)],
    { stdio: 'ignore' },
  );
};
const stopAgent = async () => {
  agent?.kill();
  agent = null;
  await new Promise((r) => setTimeout(r, 500));
};
const printed = () => {
  try {
    return readdirSync(PRINTS)
      .filter((f) => f.endsWith('.txt'))
      .sort();
  } catch {
    return [];
  }
};
/** Waits for `count` new printed files after `before` and returns their contents. */
async function waitPrints(before, count = 1, timeout = 15_000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const now = printed();
    if (now.length >= before.length + count) {
      return now
        .filter((f) => !before.includes(f))
        .map((f) => ({ file: f, text: readFileSync(path.join(PRINTS, f), 'utf8') }));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`expected ${count} print(s), got ${printed().length - before.length}`);
}

const browser = await chromium.launch({
  ...BROWSER,
  args: ['--disable-gpu', '--disable-extensions'],
});
const errors = [];
const watch = (p, label) => {
  p.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${label} console: ${m.text()}`));
  p.on(
    'response',
    (r) =>
      r.status() >= 400 &&
      errors.push(`${label} HTTP ${r.status()} ${r.request().method()} ${r.url()}`),
  );
};
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
});
page = await context.newPage();
const panel = page;
watch(panel, 'panel');
const agentPage = await context.newPage();
watch(agentPage, 'agent');

const toast = (text) =>
  page.locator('[data-sonner-toast]', { hasText: text }).first().waitFor({ timeout: 10_000 });
const shot = (name, p = page) => p.screenshot({ path: path.join(OUT, `printing-${name}.png`) });
const card = (title) =>
  page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText(title, { exact: true }) })
    .first();
const dialog = (name) => page.getByRole('dialog', { name });
const choose = async (scope, label, option) => {
  await scope.getByLabel(label, { exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
};

async function login(email) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

let code = '';

await step('manager: printing page, add a computer and get the pairing code', async () => {
  await login('gerente@demo.local');
  await page.getByRole('link', { name: 'Impressão' }).click();
  await page.getByRole('heading', { name: 'Impressão' }).waitFor();
  await page.getByText('Nenhum computador vinculado').waitFor();
  await shot('01-empty');
  await page.getByRole('button', { name: 'Adicionar computador' }).click();
  const d = dialog('Adicionar computador');
  await d.getByLabel('Nome').fill('PC do caixa');
  await d.getByRole('button', { name: 'Criar e gerar código' }).click();
  const c = dialog('Vincular PC do caixa');
  code = (await c.getByLabel('Código de vínculo').innerText()).trim();
  if (!/^\d{6}$/.test(code)) throw new Error(`code ${code}`);
  await c.getByText('http://127.0.0.1:9180').waitFor();
  await shot('02-code');
  await c.getByRole('button', { name: 'Concluir' }).click();
});

await step('agent: local page pairs the computer (wrong code refused first)', async () => {
  startAgent();
  page = agentPage;
  try {
    for (let i = 0; i < 40; i++) {
      try {
        await agentPage.goto(`http://127.0.0.1:${AGENT_PORT}/`);
        break;
      } catch {
        await agentPage.waitForTimeout(250);
      }
    }
    await agentPage.getByLabel('Endereço do sistema').fill(API);
    await agentPage.getByLabel('Código da unidade').fill('demo');
    const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
    await agentPage.getByLabel('Código de vínculo (6 números)').fill(wrong);
    await agentPage.getByRole('button', { name: 'Vincular' }).click();
    await agentPage.getByText('Não foi possível: Código inválido ou expirado').waitFor();
    await agentPage.getByLabel('Código da unidade').fill('demo');
    await agentPage.getByLabel('Código de vínculo (6 números)').fill(code);
    await agentPage.getByRole('button', { name: 'Vincular' }).click();
    await agentPage.getByText('Computador vinculado').waitFor();
    await agentPage.getByText('Conectado').waitFor({ timeout: 10_000 });
    await shot('03-agent-page', agentPage);
  } finally {
    page = panel;
  }
});

await step('panel: the computer shows connected, with version and memory', async () => {
  await page.bringToFront();
  const agents = card('Computadores que imprimem');
  await agents.getByText('Conectado').waitFor({ timeout: 15_000 });
  // Memory comes with the agent heartbeat: give it a full cycle on a busy machine.
  await agents.getByText(/versão 1\.0\.0 · memória \d+ MB/).waitFor({ timeout: 60_000 });
});

await step('printers: address validation, kitchen by IP and cash as virtual', async () => {
  await page.getByRole('button', { name: 'Nova impressora' }).click();
  let d = dialog('Nova impressora');
  await d.getByLabel('Nome').fill('Cozinha');
  await d.getByLabel('Endereço').fill('192.168.0.300');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await d.getByText('Informe o IP da impressora').waitFor();
  await d.getByLabel('Endereço').fill('192.168.0.50');
  await choose(d, 'Marca e modelo', 'Elgin i9 / i7 / i8');
  await shot('04-printer-dialog');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await toast('Impressora cadastrada');
  await d.waitFor({ state: 'detached' });

  await page.getByRole('button', { name: 'Nova impressora' }).click();
  d = dialog('Nova impressora');
  await d.getByLabel('Nome').fill('Caixa');
  await choose(d, 'Conexão', 'Virtual (arquivo, para testes)');
  await choose(d, 'Largura do papel', '58 mm');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await toast('Impressora cadastrada');
  await d.waitFor({ state: 'detached' });
});

await step('test page prints the accents line and the paper width', async () => {
  const before = printed();
  const row = card('Impressoras')
    .locator('li')
    .filter({ has: page.getByText('Caixa', { exact: true }) });
  await row.getByRole('button', { name: 'Imprimir teste' }).click();
  await toast('Página de teste enviada para Caixa');
  const [test] = await waitPrints(before);
  if (!test.text.includes('Pão, maçã, açaí, coração')) throw new Error('no accents line');
  if (!test.text.includes('58 mm (32 colunas)')) throw new Error('no paper width');
  await row.getByText('Pronta').waitFor({ timeout: 10_000 });
});

await step('sectors and cash printer: tickets per sector, 2 copies in the kitchen', async () => {
  const routing = card('Comandas por setor');
  for (const [sector, printer] of [
    ['Cozinha', 'Cozinha (PC do caixa)'],
    ['Pizzaria', 'Cozinha (PC do caixa)'],
    ['Bar', 'Caixa (PC do caixa)'],
  ]) {
    await choose(routing, `Impressora de ${sector}`, printer);
  }
  await choose(routing, 'Vias de Cozinha', '2 vias');
  await routing.getByRole('button', { name: 'Salvar setores' }).click();
  await toast('Impressão por setor salva');
  const settings = card('Caixa e entregas');
  await choose(settings, 'Impressora do caixa', 'Caixa (PC do caixa)');
  await settings.getByRole('button', { name: 'Salvar' }).click();
  await toast('Configuração salva');
  await shot('05-configured');
});

let tab = null;
await step('an order sends one ticket per sector; the kitchen gets 2 copies', async () => {
  const token = await apiLogin('garcom@demo.local');
  const products = await apiCall(token, 'GET', '/menu/products');
  // Products without required options (tried in turn: the API refuses the others).
  const candidates = (sector) =>
    products.filter((p) => p.sectorName === sector && p.kind === 'STANDARD' && !p.isPaused);
  const tables = await apiCall(token, 'GET', '/tables');
  const free = tables.find((t) => !t.session);
  const before = printed();
  for (const food of candidates('Cozinha')) {
    for (const drink of candidates('Bar')) {
      tab = await apiCall(token, 'POST', '/orders', {
        type: 'DINE_IN',
        tableId: free.id,
        tabLabel: 'Impressão',
        items: [
          { productId: food.id, quantity: 1, notes: 'sem cebola' },
          { productId: drink.id, quantity: 2 },
        ],
      }).catch(() => null);
      if (tab) break;
    }
    if (tab) break;
  }
  if (!tab) throw new Error('no orderable products');
  tab.tableName = free.name;
  const tickets = await waitPrints(before, 2);
  const kitchen = tickets.find((t) => t.text.includes('COZINHA'));
  const bar = tickets.find((t) => t.text.includes('BAR'));
  if (!kitchen || !bar) throw new Error('missing a sector ticket');
  if (!kitchen.text.includes('▌SEM CEBOLA▐')) throw new Error('removal not inverted');
  if (kitchen.text.split(`#${tab.number}`).length - 1 < 2) throw new Error('kitchen not 2 copies');
  if (!kitchen.text.includes(`Mesa ${free.name} · Impressão`)) throw new Error('no table title');
});

await step('order detail: 2nd copy of the tickets and what was printed', async () => {
  await page.goto(`${WEB}/pedidos`);
  await page.getByRole('button', { name: `Pedido ${tab.number}`, exact: true }).click();
  const sheet = page.getByRole('dialog');
  const before = printed();
  await sheet.getByRole('button', { name: '2ª via das comandas' }).click();
  await toast('2 comanda(s) enviada(s) como 2ª via');
  const copies = await waitPrints(before, 2);
  if (!copies.every((c) => c.text.includes('2ª VIA'))) throw new Error('2nd copy not marked');
  await sheet.getByRole('button', { name: 'O que foi impresso' }).click();
  await sheet.getByText('· 2ª via').first().waitFor();
  await sheet
    .getByRole('button', { name: /^Ver Comanda/ })
    .first()
    .click();
  await sheet.getByLabel(/^Prévia: Comanda/).waitFor();
  await shot('06-order-prints');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'detached' });
});

await step('pre-bill goes straight to the cash printer', async () => {
  await page.getByRole('link', { name: 'Mesas' }).click();
  await page.getByRole('button', { name: new RegExp(`^${tab.tableName}\\s`) }).click();
  await page.getByRole('button', { name: 'Pré-conta' }).click();
  const d = dialog(`Pré-conta · Mesa ${tab.tableName}`);
  const before = printed();
  await d.getByRole('button', { name: 'Imprimir no caixa' }).click();
  await toast('Pré-conta enviada para a impressora do caixa');
  const [bill] = await waitPrints(before);
  if (!bill.text.includes('PRÉ-CONTA') || !bill.text.includes('Não é documento fiscal'))
    throw new Error('pre-bill content');
});

await step('agent off: an old job is held; the alert lets someone print it as late', async () => {
  await stopAgent();
  await page.goto(`${WEB}/configuracoes/impressao`);
  const row = card('Impressoras')
    .locator('li')
    .filter({ has: page.getByText('Caixa', { exact: true }) });
  await row.getByRole('button', { name: 'Imprimir teste' }).click();
  await toast('Página de teste enviada para Caixa');
  // The PC stayed off for 45 minutes (the job ages in the database). Relative to its own
  // creation time (the API clock), not the database clock: also right with a simulated clock.
  execFileSync('docker', [
    'exec',
    'app-postgres-1',
    'psql',
    '-U',
    'app',
    '-d',
    'app_db',
    '-c',
    `UPDATE "PrintJob" SET "createdAt" = "createdAt" - interval '45 minutes' WHERE status = 'PENDING' AND kind = 'TEST_PAGE'`,
  ]);
  const before = printed();
  startAgent();
  const badge = page.getByRole('button', { name: /^Impressão: \d+ alerta/ });
  await badge.waitFor({ timeout: 20_000 });
  await badge.click();
  const sheet = page.getByRole('dialog', { name: 'Impressão' });
  await sheet.getByText('Impressões retidas').waitFor();
  await shot('07-held-alert');
  await sheet.getByRole('button', { name: 'Imprimir', exact: true }).click();
  await toast('Enviado para impressão');
  const [late] = await waitPrints(before);
  if (!late.text.includes('IMPRESSÃO ATRASADA')) throw new Error('late mark missing');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Impressão funcionando' }).waitFor({ timeout: 10_000 });
});

await step('dark theme and phone width without horizontal scroll', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`${WEB}/configuracoes/impressao`);
  await card('Impressoras').waitFor();
  await shot('08-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot('09-phone');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('page scrolls horizontally');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
});

await step('revoking the computer stops it right away (agent page shows it)', async () => {
  await page.goto(`${WEB}/configuracoes/impressao`);
  const agents = card('Computadores que imprimem');
  await agents.getByRole('button', { name: 'Desvincular' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Desvincular' }).click();
  await toast('Computador desvinculado');
  await agentPage.goto(`http://127.0.0.1:${AGENT_PORT}/`);
  for (let i = 0; i < 20; i++) {
    if (await agentPage.getByText('desvinculado no painel').count()) break;
    await agentPage.waitForTimeout(500);
    await agentPage.reload();
  }
  await agentPage.getByText('desvinculado no painel').first().waitFor();
});

// Leaves the demo as it was: printers removed (sectors and cash printer are unset with them).
await step('cleanup: printers removed', async () => {
  for (const name of ['Cozinha', 'Caixa']) {
    const row = card('Impressoras').locator('li').filter({ hasText: name }).first();
    await row.getByRole('button', { name: `Remover ${name}` }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remover' }).click();
    await toast('Impressora removida');
  }
});

await stopAgent();
await browser.close();
console.log(results.join('\n'));
// Expected: 401 for the session check on the login page without a refresh cookie.
const unexpected = errors.filter((e) => !/HTTP 401 /.test(e) && !/status of 401/.test(e));
console.log(`\nErros HTTP/console: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 20)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
