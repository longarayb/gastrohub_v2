// Orders screens walkthrough against the production build, using the demo seed.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright-core';
import { BROWSER } from './browser.mjs';

// Screenshots go to ./screenshots (gitignored).
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
    results.push(`FAIL  ${name}: ${e.message.split('\n')[0]} @ ${page.url()}`);
    await page.screenshot({ path: path.join(OUT, `orders-fail-${results.length}.png`) });
    await page.keyboard.press('Escape').catch(() => {});
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
  ...BROWSER,
  args: [
    '--disable-gpu',
    '--disable-extensions',
    '--renderer-process-limit=1',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
});
page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on(
  'response',
  (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`),
);

const toast = (text) =>
  page.locator('[data-sonner-toast]', { hasText: text }).first().waitFor({ timeout: 10_000 });
const shot = (name) => page.screenshot({ path: path.join(OUT, `orders-${name}.png`) });
const column = (name) =>
  page.locator('section', { has: page.getByRole('heading', { name, exact: true }) });
const card = (n) => page.getByRole('button', { name: `Pedido ${n}`, exact: true });
const sheet = () => page.getByRole('dialog');

async function login(email) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}
async function logout() {
  await page.getByRole('button', { name: 'Menu do usuário' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await page.waitForURL('**/login');
}
async function closeSheet() {
  await page.keyboard.press('Escape');
  await sheet().waitFor({ state: 'detached' });
}

await step('cashier lands on the board with seeded orders and realtime on', async () => {
  await login('caixa@demo.local');
  await page.waitForURL('**/pedidos');
  await page.getByRole('status').filter({ hasText: 'Tempo real' }).waitFor({ timeout: 15_000 });
  for (const name of ['Pendente', 'Aceito', 'Em preparo', 'Pronto', 'Saiu para entrega']) {
    await column(name).waitFor();
  }
  await column('Pendente')
    .getByRole('button', { name: /^Pedido \d+$/ })
    .nth(1)
    .waitFor();
  await page.getByRole('button', { name: 'Ativar som de novos pedidos' }).click();
  await page.getByRole('button', { name: 'Som ativado' }).waitFor();
  await shot('01-board');
});

await step('type filter hides other types and the dispatched column', async () => {
  await page.getByRole('tab', { name: 'Mesa' }).click();
  await column('Saiu para entrega').waitFor({ state: 'detached' });
  const titles = await page.locator('article').allInnerTexts();
  if (!titles.length || titles.some((t) => !t.includes('Mesa')))
    throw new Error('non dine-in card shown');
  await page.getByRole('tab', { name: 'Todos' }).click();
});

await step('accepting a pending delivery order from the sheet', async () => {
  const pending = column('Pendente').locator('article').filter({ hasText: 'Mariana' });
  await pending.getByRole('button', { name: /^Pedido \d+$/ }).click();
  await sheet().getByText('X-Bacon').waitFor();
  await sheet().getByText('troco para R$ 100,00').waitFor();
  await sheet().getByText('Interfone quebrado', { exact: false }).waitFor();
  await shot('02-sheet-pending');
  await sheet().getByRole('button', { name: 'Aceitar' }).click();
  await sheet().getByRole('button', { name: 'Iniciar preparo' }).waitFor();
  await closeSheet();
  await column('Aceito').locator('article').filter({ hasText: 'Mariana' }).waitFor();
});

await step('advance from the card', async () => {
  const accepted = column('Aceito').locator('article').filter({ hasText: 'Juliana' });
  await accepted.getByRole('button', { name: 'Iniciar preparo' }).click();
  await column('Em preparo').locator('article').filter({ hasText: 'Juliana' }).waitFor();
});

let createdNumber;
await step('composer: takeout burger with required modifier and extra', async () => {
  await page.getByRole('link', { name: 'Novo pedido' }).click();
  await page.waitForURL('**/pedidos/novo');
  await page.getByRole('button', { name: /^X-Burguer/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Adicionar/ }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Ponto da carne' }).waitFor();
  await dialog.getByRole('button', { name: 'Ao ponto' }).click();
  await dialog.getByRole('button', { name: /^Bacon/ }).click();
  await dialog.getByRole('button', { name: 'Aumentar' }).last().click(); // bacon x2
  await dialog.getByRole('button', { name: 'Aumentar', exact: true }).first().waitFor();
  await shot('03-builder');
  await dialog.getByRole('button', { name: /^Adicionar · R\$/ }).click();
  await dialog.waitFor({ state: 'detached' });
  await page.getByLabel('Itens do pedido').getByText('X-Burguer').waitFor();
  await page.getByLabel('Telefone').fill('11912345678');
  await page.getByLabel('Nome').fill('Cliente Balcão Teste');
  await shot('04-composer');
  await page.getByRole('button', { name: 'Criar pedido' }).click();
  await toast(/Pedido #\d+ criado/);
  const text = await page.locator('[data-sonner-toast]').first().innerText();
  createdNumber = Number(text.match(/#(\d+)/)[1]);
  await page.waitForURL('**/pedidos');
  await column('Aceito')
    .getByRole('button', { name: `Pedido ${createdNumber}`, exact: true })
    .waitFor();
});

await step('composer: half-and-half pizza for delivery with saved customer', async () => {
  await page.getByRole('link', { name: 'Novo pedido' }).click();
  await page.getByRole('tab', { name: 'Delivery' }).click();
  await page.getByLabel('Telefone').fill('(11) 9912');
  await page
    .getByLabel('Clientes encontrados')
    .getByRole('button', { name: /Mariana/ })
    .click();
  await page.getByRole('radio', { name: /Avenida Paulista, 1500/ }).waitFor();
  await page.getByRole('button', { name: 'Montar pizza' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Grande/ }).click();
  await dialog.getByRole('button', { name: /^Calabresa/ }).click();
  await dialog.getByRole('button', { name: /^Marguerita/ }).click();
  await dialog.getByRole('button', { name: /^Catupiry/ }).click();
  await dialog.getByRole('button', { name: /^Adicionar · R\$/ }).click();
  // The fee comes from the delivery area of the address (D029).
  await page
    .getByRole('region', { name: 'Taxa de entrega' })
    .getByText('Centro expandido')
    .waitFor();
  await page.getByLabel('Forma de pagamento').click();
  await page.getByRole('option', { name: 'PIX' }).click();
  await shot('05-composer-delivery');
  await page.getByRole('button', { name: 'Criar pedido' }).click();
  await toast(/Pedido #\d+ criado/);
  await page.waitForURL('**/pedidos');
});

await step('composer: delivery validation errors without customer/address', async () => {
  await page.getByRole('link', { name: 'Novo pedido' }).click();
  await page.getByRole('tab', { name: 'Delivery' }).click();
  await page.getByRole('button', { name: /^Água mineral/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Adicionar · R\$/ })
    .click();
  await page.getByRole('button', { name: 'Criar pedido' }).click();
  await page.getByText('Informe o nome do cliente').first().waitFor();
  await page.getByRole('link', { name: 'Voltar' }).click();
  await page.waitForURL('**/pedidos');
});

await step('realtime: order created elsewhere appears without reload', async () => {
  const token = await apiLogin('gerente@demo.local');
  const catalog = await apiCall(token, 'GET', '/menu/catalog?channel=COUNTER');
  const water = catalog.categories
    .flatMap((c) => c.products)
    .find((p) => p.name === 'Água mineral 500 ml');
  const order = await apiCall(
    token,
    'POST',
    '/orders',
    { type: 'TAKEOUT', items: [{ productId: water.id, quantity: 3 }] },
    { 'Idempotency-Key': randomUUID() },
  );
  await column('Aceito')
    .getByRole('button', { name: `Pedido ${order.number}`, exact: true })
    .waitFor({ timeout: 10_000 });
});

await step('stale version shows a conflict message and reloads', async () => {
  await card(createdNumber).click();
  await sheet().getByRole('button', { name: 'Iniciar preparo' }).waitFor();
  const token = await apiLogin('gerente@demo.local');
  const board = await apiCall(token, 'GET', '/orders?board=true');
  const o = board.find((x) => x.number === createdNumber);
  await apiCall(token, 'POST', `/orders/${o.id}/status`, {
    expectedVersion: o.version,
    status: 'PREPARING',
  });
  await sheet().getByRole('button', { name: 'Marcar como pronto' }).waitFor({ timeout: 10_000 }); // realtime refresh
  // Force a stale click: change again in the background, then click before the refetch lands.
  await page.route('**/api/orders/*', (route) =>
    route.request().method() === 'GET'
      ? new Promise((r) => setTimeout(() => r(route.continue().catch(() => {})), 1500))
      : route.continue(),
  );
  const fresh = await apiCall(token, 'GET', `/orders/${o.id}`);
  await apiCall(token, 'POST', `/orders/${o.id}/status`, {
    expectedVersion: fresh.version,
    status: 'READY',
  });
  await sheet().getByRole('button', { name: 'Marcar como pronto' }).click();
  await toast(/alterado por outra pessoa|atualize|versão/i);
  await page.unroute('**/api/orders/*');
  // READY takeout without payment: the next action is receiving (D023).
  await sheet()
    .getByRole('button', { name: /Receber e entregar/ })
    .waitFor({ timeout: 10_000 });
  await closeSheet();
});

await step('cancel order requires a reason', async () => {
  await card(createdNumber).click();
  await sheet().getByRole('button', { name: 'Cancelar pedido' }).click();
  const confirm = page.getByRole('dialog', { name: /Cancelar o pedido/ });
  await confirm.getByRole('button', { name: 'Cancelar pedido' }).click();
  await confirm.getByText('Informe o motivo').waitFor();
  await confirm.getByLabel('Motivo').fill('Cliente não veio buscar');
  await confirm.getByRole('button', { name: 'Cancelar pedido' }).click();
  await toast('Pedido cancelado');
  await sheet().getByText('Cancelado: Cliente não veio buscar').waitFor();
  await closeSheet();
  await page.getByRole('button', { name: /^Finalizados/ }).click();
  // Yesterday's finished orders (seed history) are also listed and may repeat the number.
  await page.getByRole('button', { name: new RegExp(`^#${createdNumber} .*Cancelado`) }).waitFor();
  await shot('06-finished');
});

await step('dine-in tab: cancel sent item, discount and remove service fee', async () => {
  await page
    .locator('article')
    .filter({ hasText: 'Carlos' })
    .getByRole('button', { name: /^Pedido/ })
    .click();
  await sheet().getByText('Rodada 2').waitFor();
  await sheet().getByText('Taxa de serviço (10%)').waitFor();
  await sheet().getByRole('button', { name: 'Cancelar Frango à passarinho' }).click();
  const d1 = page.getByRole('dialog', { name: /Cancelar Frango/ });
  await d1.getByLabel('Motivo').fill('Demorou demais');
  await d1.getByRole('button', { name: 'Cancelar item' }).click();
  await toast('Item cancelado');
  await sheet().getByRole('button', { name: 'Alterar desconto' }).click();
  const d2 = page.getByRole('dialog', { name: 'Desconto no pedido' });
  await d2.getByRole('button', { name: '%' }).click();
  await d2.getByLabel('Desconto', { exact: true }).fill('10');
  await d2.getByLabel('Motivo').fill('Cliente frequente');
  await d2.getByRole('button', { name: 'Aplicar' }).click();
  await toast('Desconto atualizado');
  await sheet().getByRole('button', { name: 'retirar' }).click();
  const d3 = page.getByRole('dialog', { name: /Retirar a taxa/ });
  await d3.getByLabel('Motivo').fill('Cliente pediu');
  await d3.getByRole('button', { name: 'Retirar taxa' }).click();
  await toast('Taxa de serviço retirada');
  await sheet().getByText('Taxa de serviço (retirada)').waitFor();
  await shot('07-tab-sheet');
  await closeSheet();
});

await step('cashier cannot open the coupons screen', async () => {
  await page.goto(`${WEB}/cupons`);
  await page.getByText('Acesso não permitido').waitFor();
  await logout();
});

await step('waiter: table map, send draft round and add items to a tab', async () => {
  await login('garcom@demo.local');
  await page.waitForURL('**/pedidos');
  await page.getByRole('link', { name: 'Mesas' }).click();
  await page.getByRole('button', { name: /^2\s/ }).waitFor();
  await shot('08-tables');
  await page.getByRole('button', { name: /^7\s/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^#\d+/ }).click();
  await sheet().getByText('não enviada').waitFor();
  await sheet()
    .getByRole('button', { name: /Enviar 2 itens/ })
    .click();
  await toast('Itens enviados para a produção');
  await sheet().getByRole('link', { name: 'Adicionar itens' }).click();
  await page.waitForURL('**/pedidos/novo?pedido=*');
  await page.getByRole('heading', { name: /Adicionar itens · #\d+/ }).waitFor();
  await page.getByRole('button', { name: /^Chope 300 ml/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Adicionar · R\$/ })
    .click();
  await page.getByRole('button', { name: 'Enviar itens' }).click();
  await toast('Itens enviados para a produção');
  await page.waitForURL('**/pedidos');
});

await step('waiter: open a new tab on an occupied table', async () => {
  await page.goto(`${WEB}/mesas`);
  await page.getByRole('button', { name: /^2\s/ }).click();
  await page.getByRole('link', { name: 'Nova conta' }).click();
  await page.waitForURL('**/pedidos/novo?mesa=*');
  await page.getByText('Mesa ocupada: será aberta uma nova conta').waitFor();
  await page.getByLabel('Conta / cliente').fill('Lucas');
  await page.getByRole('button', { name: /^Guaraná lata/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Adicionar · R\$/ })
    .click();
  await page.getByRole('button', { name: 'Abrir conta e enviar' }).click();
  await toast(/Pedido #\d+ criado/);
  await page.waitForURL('**/mesas');
  await page.getByRole('button', { name: /^2\s/ }).getByText('3 conta(s)').waitFor();
});

await step('waiter has no access to discounts', async () => {
  await page.goto(`${WEB}/pedidos`);
  await page
    .locator('article')
    .filter({ hasText: 'Fernanda' })
    .getByRole('button', { name: /^Pedido/ })
    .click();
  await sheet().getByText('Burger vegetariano').waitFor();
  if (await sheet().getByRole('button', { name: 'Alterar desconto' }).count())
    throw new Error('discount visible to waiter');
  if (await sheet().getByRole('button', { name: 'Cancelar pedido' }).count())
    throw new Error('cancel visible to waiter');
  // Closing needs the balance received first, and waiters do not receive payments.
  const receive = sheet().getByRole('button', { name: /Receber e fechar/ });
  await receive.waitFor();
  if (await receive.isEnabled()) throw new Error('waiter can receive payments');
  await closeSheet();
  await logout();
});

await step('kitchen sees the board but cannot create orders', async () => {
  await login('cozinha@demo.local');
  await page.waitForURL('**/pedidos');
  if (await page.getByRole('link', { name: 'Novo pedido' }).count())
    throw new Error('new order visible to kitchen');
  await page.goto(`${WEB}/pedidos/novo`);
  await page.getByText('Acesso não permitido').waitFor();
  await logout();
});

await step('owner: coupons CRUD and service fee order types', async () => {
  await login('dono@demo.local');
  await page.goto(`${WEB}/cupons`);
  await page.getByRole('cell', { name: 'BEMVINDO10', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Novo cupom' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Código').fill('pix5');
  await d.getByRole('radio', { name: 'Valor fixo' }).click();
  await d.getByLabel('Desconto (R$)').fill('500');
  await d.getByLabel('Limite de usos').fill('100');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await toast('Cupom criado');
  await page.getByRole('cell', { name: 'PIX5', exact: true }).waitFor();
  await shot('09-coupons');
  await page.goto(`${WEB}/configuracoes/empresa`);
  await page.getByText('Cobrar taxa de serviço em').waitFor();
  await page.getByRole('checkbox', { name: 'Balcão/Retirada' }).waitFor();
});

await step('mobile and dark board', async () => {
  await page.goto(`${WEB}/pedidos`);
  await page.locator('article').first().waitFor();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await shot('10-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await shot('11-mobile');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('page scrolls horizontally on mobile');
});

await browser.close();
console.log(results.join('\n'));
console.log('\nErrors seen:\n' + [...new Set(errors)].join('\n'));
