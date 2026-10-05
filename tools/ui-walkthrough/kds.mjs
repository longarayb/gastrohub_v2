// Kitchen display walkthrough (feat/kds) against the production build and a fresh demo seed.
// Two browser contexts: the paired bar tablet (no user login) and a kitchen user.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });
const WEB = 'http://localhost:3000';
const API = 'http://localhost:3333/api';
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
    await page.screenshot({ path: path.join(OUT, `kds-fail-${results.length}.png`) });
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
async function apiCall(token, method, p, body, headers = {}) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--disable-gpu', '--disable-extensions', '--autoplay-policy=no-user-gesture-required'],
});
// Records every tone played (type and frequency) to check the new-ticket and cancel sounds.
const recordTones = () => {
  window.__tones = [];
  const original = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function () {
    const osc = original.call(this);
    const start = osc.start.bind(osc);
    osc.start = (when) => {
      window.__tones.push({ type: osc.type, frequency: osc.frequency.value });
      return start(when);
    };
    return osc;
  };
};
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

const managerContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
});
const tabletContext = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  locale: 'pt-BR',
});
await tabletContext.addInitScript(recordTones);
const manager = await managerContext.newPage();
const tablet = await tabletContext.newPage();
watch(manager, 'manager');
watch(tablet, 'tablet');
page = manager;

const toast = (p, text) =>
  p.locator('[data-sonner-toast]', { hasText: text }).first().waitFor({ timeout: 10_000 });
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `kds-${name}.png`) });
const ticket = (p, text) => p.locator('article').filter({ hasText: text });
const tones = async (p) => p.evaluate(() => window.__tones.slice());

async function login(p, email) {
  await p.goto(`${WEB}/login`);
  await p.waitForLoadState('networkidle');
  await p.getByLabel('E-mail').fill(email);
  await p.getByLabel('Senha').fill(PASSWORD);
  await p.getByRole('button', { name: 'Entrar' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

let pairing = { code: '', slug: '' };
const ids = {};

await step('manager: alert limits per sector and a new kitchen screen with a code', async () => {
  page = manager;
  await login(manager, 'gerente@demo.local');
  await manager.goto(`${WEB}/cardapio/setores`);
  await manager.getByLabel('Alerta amarelo de Bar (minutos)').fill('3');
  await manager.getByLabel('Alerta vermelho de Bar (minutos)').fill('2');
  await manager.getByRole('button', { name: 'Salvar' }).first().click();
  await toast(manager, 'O alerta vermelho deve vir depois do amarelo');
  await manager.getByLabel('Alerta vermelho de Bar (minutos)').fill('6');
  await manager.getByRole('button', { name: 'Salvar' }).first().click();
  await toast(manager, 'Setor atualizado');
  await manager.getByText('TV da cozinha').waitFor();
  await manager.getByRole('button', { name: 'Nova tela' }).click();
  const d = manager.getByRole('dialog', { name: 'Nova tela da cozinha' });
  await d.getByLabel('Nome').fill('Tablet do bar');
  await d.getByRole('checkbox', { name: 'Bar' }).click();
  await d.getByRole('button', { name: 'Criar e gerar código' }).click();
  const code = manager.getByRole('dialog', { name: 'Vincular Tablet do bar' });
  pairing.code = (await code.getByLabel('Código de vínculo').innerText()).trim();
  pairing.slug = 'demo';
  if (!/^\d{6}$/.test(pairing.code)) throw new Error(`code ${pairing.code}`);
  await shot(manager, '01-pairing-code');
  await code.getByRole('button', { name: 'Concluir' }).click();
});

await step(
  'tablet: a wrong code is refused, the right one pairs without a user login',
  async () => {
    page = tablet;
    await tablet.goto(`${WEB}/kds/vincular?loja=demo`);
    await tablet
      .getByLabel('Código de 6 números')
      .fill(pairing.code === '000000' ? '111111' : '000000');
    await tablet.getByRole('button', { name: 'Vincular' }).click();
    await tablet.getByRole('alert').filter({ hasText: 'Código inválido ou expirado' }).waitFor();
    await shot(tablet, '02-pair-error');
    await tablet.getByLabel('Código de 6 números').fill(pairing.code);
    await tablet.getByRole('button', { name: 'Vincular' }).click();
    await tablet.waitForURL('**/kds');
    await tablet.getByText('Toque para iniciar').waitFor();
    await shot(tablet, '03-tap-to-start');
    await tablet.getByText('Toque para iniciar').click();
    await tablet.getByText('Tablet do bar').waitFor();
    const played = await tones(tablet);
    if (!played.length) throw new Error('no sound after the tap');
    // Only its sector, no expedition.
    await tablet.getByRole('button', { name: 'Bar', exact: true }).waitFor();
    if (await tablet.getByRole('button', { name: 'Cozinha', exact: true }).count())
      throw new Error('kitchen sector on the bar tablet');
    if (await tablet.getByRole('button', { name: /Expedição/ }).count())
      throw new Error('expedition on the bar tablet');
    await ticket(tablet, 'Guaraná lata').getByText('do Combo X-Burguer').waitFor();
    await shot(tablet, '04-bar-board');
  },
);

await step('tablet: start, ready and undo a ticket', async () => {
  const card = ticket(tablet, 'Guaraná lata');
  await card.getByRole('button', { name: 'Iniciar' }).click();
  await tablet
    .getByRole('region', { name: 'Em preparo' })
    .locator('article')
    .filter({ hasText: 'Guaraná lata' })
    .waitFor();
  await ticket(tablet, 'Guaraná lata').getByRole('button', { name: 'Pronto' }).click();
  const done = tablet
    .getByRole('region', { name: 'Pronto (recentes)' })
    .locator('article')
    .filter({ hasText: 'Guaraná lata' });
  await done.waitFor();
  await done.getByRole('button', { name: 'Desfazer' }).click();
  await toast(tablet, 'Item voltou para o preparo');
  await tablet
    .getByRole('region', { name: 'Em preparo' })
    .locator('article')
    .filter({ hasText: 'Guaraná lata' })
    .waitFor();
});

await step(
  'realtime: a new combo chimes on the bar; its cancellation is struck with another sound',
  async () => {
    const token = await apiLogin('caixa@demo.local');
    const catalog = await apiCall(token, 'GET', '/menu/catalog?channel=COUNTER');
    const products = catalog.categories.flatMap((c) => c.products);
    const comboProduct = products.find((p) => p.name === 'Combo X-Burguer');
    const groups = comboProduct.modifierGroups ?? comboProduct.modifiers ?? [];
    const pick = (g) => ({ groupId: g.groupId ?? g.id, optionId: g.options[0].id, quantity: 1 });
    const order = await apiCall(
      token,
      'POST',
      '/orders',
      {
        type: 'TAKEOUT',
        customer: { name: 'Teste KDS', phone: '(11) 97777-1234' },
        items: [
          {
            productId: comboProduct.id,
            quantity: 1,
            modifiers: groups.filter((g) => g.minSelect > 0).map(pick),
          },
        ],
      },
      { 'Idempotency-Key': randomUUID() },
    );
    ids.order = order;
    await tablet.evaluate(() => (window.__tones = []));
    await ticket(tablet, `#${order.number}`).waitFor({ timeout: 10_000 });
    await tablet.waitForFunction(() => window.__tones.some((t) => t.type === 'sine'));
    await apiCall(token, 'POST', `/orders/${order.id}/status`, {
      expectedVersion: order.version,
      status: 'CANCELED',
      reason: 'Cliente desistiu',
    });
    const struck = ticket(tablet, `#${order.number}`);
    await struck.getByText('Pedido cancelado').waitFor({ timeout: 10_000 });
    await tablet.waitForFunction(() => window.__tones.some((t) => t.type === 'square'));
    await shot(tablet, '05-canceled');
    await struck.getByRole('button', { name: 'Ok, retirar da tela' }).click();
    await struck.waitFor({ state: 'detached' });
  },
);

await step('kitchen user: removals highlighted, consolidated view and sold out', async () => {
  page = manager;
  await manager.getByRole('button', { name: 'Menu do usuário' }).click();
  await manager.getByRole('menuitem', { name: 'Sair' }).click();
  await manager.waitForURL('**/login');
  await login(manager, 'cozinha@demo.local');
  await manager.getByRole('link', { name: 'Tela da cozinha' }).click();
  await manager.waitForURL('**/kds');
  await manager.getByText('Toque para iniciar').click();
  // A user sees every sector; keep only the kitchen.
  for (const name of ['Bar', 'Pizzaria']) {
    const chip = manager.getByRole('button', { name, exact: true });
    if ((await chip.getAttribute('aria-pressed')) === 'true') await chip.click();
  }
  const combo = ticket(manager, 'Combo X-Burguer');
  await combo.getByRole('list', { name: 'Remoções' }).getByText('sem cebola').waitFor();
  await combo.getByText('Obs.: capricha no molho').waitFor();
  await shot(manager, '06-kitchen-board');
  await manager.getByRole('button', { name: 'Consolidado' }).click();
  await manager
    .getByRole('complementary', { name: 'Consolidado' })
    .getByText('Combo X-Burguer')
    .waitFor();
  await manager.getByRole('button', { name: 'Acabou' }).click();
  const sold = manager.getByRole('dialog', { name: 'Acabou' });
  await sold.locator('li', { hasText: 'X-Salada' }).getByRole('button', { name: 'Acabou' }).click();
  await toast(manager, 'Marcado como "Acabou" até o fim do dia');
  await sold.locator('li', { hasText: 'X-Salada' }).getByRole('button', { name: 'Voltou' }).click();
  await toast(manager, 'Produto voltou ao cardápio');
  await manager.keyboard.press('Escape');
});

await step('expedition: complete takeout handed over, delivery leaves with a courier', async () => {
  const token = await apiLogin('gerente@demo.local');
  const board = await apiCall(token, 'GET', '/kds/board');
  const julianaTasks = board.tickets
    .filter((t) => t.title.includes('Juliana') && t.orderType === 'TAKEOUT')
    .flatMap((t) => t.tasks.map((x) => x.id));
  const rafael = board.tickets.filter(
    (t) => t.title.includes('Rafael') && t.orderType === 'DELIVERY',
  );
  await apiCall(token, 'POST', '/kds/tasks/ready', { taskIds: julianaTasks });
  await apiCall(token, 'POST', '/kds/tasks/ready', {
    taskIds: rafael.flatMap((t) => t.tasks.map((x) => x.id)),
  });
  await manager.getByRole('button', { name: /Expedição/ }).click();
  const juliana = manager
    .getByRole('article', { name: /Expedição pedido/ })
    .filter({ hasText: 'Juliana' });
  await juliana.getByText('Pronto para sair').waitFor({ timeout: 10_000 });
  await shot(manager, '07-expedition');
  await juliana.getByRole('button', { name: 'Entregue' }).click();
  await toast(manager, /entregue/);
  const delivery = manager
    .getByRole('article', { name: /Expedição pedido/ })
    .filter({ hasText: 'Rafael' });
  await delivery.getByLabel('Entregador').click();
  await manager.getByRole('option').first().click();
  await delivery.getByRole('button', { name: 'Saiu para entrega' }).click();
  await toast(manager, /saiu para entrega/);
  await delivery.waitFor({ state: 'detached' });
});

await step('manager revokes the tablet: it signs out right away', async () => {
  const token = await apiLogin('gerente@demo.local');
  const devices = await apiCall(token, 'GET', '/kds/devices');
  const bar = devices.find((d) => d.name === 'Tablet do bar');
  await apiCall(token, 'POST', `/kds/devices/${bar.id}/revoke`);
  page = tablet;
  await tablet.waitForURL('**/kds/vincular', { timeout: 15_000 });
});

await step('TV layout (1920×1080) without horizontal scroll', async () => {
  page = manager;
  await manager.getByRole('button', { name: /Expedição/ }).waitFor();
  for (const name of ['Cozinha', 'Bar', 'Pizzaria']) {
    const chip = manager.getByRole('button', { name, exact: true });
    if ((await chip.getAttribute('aria-pressed')) !== 'true') await chip.click();
  }
  await manager.setViewportSize({ width: 1920, height: 1080 });
  await manager.waitForTimeout(500);
  await shot(manager, '08-tv');
  const overflow = await manager.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('page scrolls horizontally');
});

await browser.close();
console.log(results.join('\n'));
// Expected: 400 from the wrong pairing code, 401 when the revoked tablet is refused and the
// user-session check on login/KDS pages without a refresh cookie.
const unexpected = errors.filter(
  (e) =>
    !/HTTP 400 POST .*kds-device\/pair/.test(e) &&
    !/HTTP 401 /.test(e) &&
    !/status of 40[01]/.test(e),
);
console.log(`\nErros HTTP/console: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 20)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
