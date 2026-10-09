// Dashboard and reports walkthrough (feat/dashboard) against the production build and the
// demo seed with 90 days of history.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BROWSER } from './browser.mjs';

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
    await page.screenshot({
      path: path.join(OUT, `dashboard-fail-${results.length}.png`),
      fullPage: true,
    });
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

const browser = await chromium.launch({
  ...BROWSER,
  args: ['--disable-gpu'],
});
const errors = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
  acceptDownloads: true,
});
// Printing: the browser dialog is replaced by the afterprint event; counts the prints.
await context.addInitScript(() => {
  window.__prints = 0;
  window.print = () => {
    window.__prints += 1;
    setTimeout(() => window.dispatchEvent(new Event('afterprint')), 20);
  };
});
page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on(
  'response',
  (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`),
);

const shot = (name, full = false) =>
  page.screenshot({ path: path.join(OUT, `dashboard-${name}.png`), fullPage: full });
const card = (label) => page.getByRole('region', { name: label, exact: true });
const kpiValue = async (label) => (await card(label).locator('p').first().innerText()).trim();
const noHorizontalScroll = async () => {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('page scrolls horizontally');
};

async function login(email) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

await step(
  'owner lands on the day dashboard: KPIs, comparison, attention now, charts',
  async () => {
    await login('dono@demo.local');
    await page.waitForURL(/\/painel/);
    await page.getByRole('heading', { name: 'Hoje' }).waitFor();
    for (const label of ['Faturamento', 'Pedidos', 'Ticket médio', 'Em aberto', 'Cancelados']) {
      await card(label).waitFor();
    }
    if (!/^R\$/.test(await kpiValue('Faturamento'))) throw new Error('revenue not in BRL');
    await card('Faturamento')
      .getByText(/vs\. .*passada, até agora|sem base de comparação/)
      .waitFor();
    await card('Atenção agora')
      .getByRole('link', { name: /aguardando aceite/ })
      .waitFor();
    await card('Vendas por canal')
      .getByText(/canais · \d+ pedidos/)
      .waitFor();
    await card('Mais vendidos').locator('li').first().waitFor();
    await card('Pedidos por hora')
      .getByRole('img', { name: /Pedidos por hora/ })
      .waitFor();
    await shot('01-day', true);
  },
);

await step('help icon explains each indicator (tap)', async () => {
  await page.getByRole('button', { name: 'O que é Faturamento?' }).click();
  await page
    .getByText(/Pedido aberto num dia e concluído no outro conta no dia da conclusão/)
    .waitFor();
  await shot('02-help');
  await page.keyboard.press('Escape');
});

await step('ticket: total and products only, alternated in the card', async () => {
  const ticket = card('Ticket médio');
  const total = await kpiValue('Ticket médio');
  await ticket.getByRole('button', { name: 'Ver só produtos' }).click();
  await ticket.getByText('só produtos', { exact: true }).waitFor();
  const products = await kpiValue('Ticket médio');
  if (products === total) throw new Error('ticket did not change');
  await ticket.getByRole('button', { name: 'Ver total com taxas' }).click();
});

await step('comparison with the 4-week average', async () => {
  await page.getByRole('radio', { name: 'Média 4 semanas' }).click();
  await card('Faturamento')
    .getByText(/vs\. média das 4 semanas|sem base/)
    .waitFor();
  await page.getByRole('radio', { name: 'Semana passada' }).click();
});

await step('real time: a new order shows up on the dashboard by itself', async () => {
  const before = Number((await kpiValue('Em aberto')).replace(/\D/g, ''));
  const token = await apiLogin('caixa@demo.local');
  const products = await apiCall(token, 'GET', '/menu/products');
  // A simple product without required options (a canned drink).
  const pick = products.find((p) => p.kind === 'STANDARD' && !p.isPaused && /lata/i.test(p.name));
  await apiCall(token, 'POST', '/orders', {
    type: 'TAKEOUT',
    items: [{ productId: pick.id, quantity: 1 }],
  });
  await page.waitForFunction(
    (prev) => {
      const el = document.querySelector('[aria-label="Em aberto"] p');
      return el && Number(el.textContent.replace(/\D/g, '')) === prev + 1;
    },
    before,
    { timeout: 15_000 },
  );
});

await step('reconciliation: received = revenue explained line by line', async () => {
  await card('Recebido').getByText('Por que o recebido é diferente do faturamento?').click();
  await card('Recebido').getByText('= Recebido').waitFor();
  if (await card('Recebido').getByText('Diferença (avise o suporte)').count()) {
    throw new Error('reconciliation difference shown');
  }
});

await step('phone: the day dashboard fits without horizontal scroll', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await card('Faturamento').waitFor();
  await page.waitForTimeout(400);
  await noHorizontalScroll();
  await shot('03-phone', true);
  // Touch targets: period/compare buttons and help icons have at least 44 px.
  const small = await page.evaluate(
    () =>
      [...document.querySelectorAll('[role="radio"], [aria-label^="O que é"]')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.height < 44 || r.width < 44)).length,
  );
  if (small) throw new Error(`${small} touch targets under 44 px`);
  await page.setViewportSize({ width: 1440, height: 900 });
});

await step('dark theme', async () => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.reload();
  await card('Faturamento').waitFor();
  await page.waitForTimeout(300);
  await shot('04-dark', true);
  await page.emulateMedia({ colorScheme: 'light' });
});

await step('sales report: 90 days, ABC curve, heatmap, CSV and A4 print', async () => {
  await page.getByRole('link', { name: 'Vendas' }).click();
  await page.getByRole('heading', { name: 'Vendas', level: 1 }).waitFor();
  await page.getByRole('radio', { name: '90 dias' }).click();
  await card('Produtos')
    .getByText(/\d+ produtos · A \d+ · B \d+ · C \d+/)
    .waitFor();
  await card('Produtos').getByRole('radio', { name: 'C', exact: true }).click();
  const classes = await card('Produtos').locator('tbody td:last-child').allInnerTexts();
  if (!classes.length || classes.some((c) => c.trim() !== 'C')) throw new Error('ABC filter');
  await card('Dia da semana × hora').getByRole('radio', { name: 'Valor' }).click();
  await card('Dia da semana × hora').locator('td[title^="Sáb"]').first().waitFor();
  await shot('05-sales', true);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.getByRole('button', { name: 'Exportar CSV' }).click();
      await page.getByRole('menuitem', { name: 'Produtos (curva ABC)' }).click();
    })(),
  ]);
  const csv = readFileSync(await download.path(), 'utf8');
  if (!csv.startsWith('﻿Produto;Categoria;Quantidade;Faturamento (R$)')) {
    throw new Error(`csv header: ${JSON.stringify(csv.slice(0, 80))}`);
  }
  if (!/;[ABC]\r\n/.test(csv)) throw new Error('csv ABC column');
  await page.getByRole('button', { name: 'Imprimir' }).click();
  await page.waitForFunction(() => window.__prints > 0);
  await page.locator('.print-a4').getByText('Relatório de vendas').waitFor({ state: 'attached' });
});

await step('loss prevention: by user, reasons, "after production" filter', async () => {
  await page.getByRole('link', { name: 'Controle de perdas' }).click();
  await page.getByRole('heading', { name: 'Controle de perdas', level: 1 }).waitFor();
  await page.getByRole('radio', { name: '90 dias' }).click();
  await card('Por usuário')
    .getByText(/após produção/)
    .first()
    .waitFor();
  await card('Motivos').locator('li').first().waitFor();
  await page.getByText('Só depois da produção').click();
  await card('Eventos').getByText('depois da produção').first().waitFor();
  await shot('06-losses', true);
});

await step('operation times: sectors and products, 120-day limit explained', async () => {
  await page.getByRole('link', { name: 'Tempos de operação' }).click();
  await page.getByRole('heading', { name: 'Tempos de operação', level: 1 }).waitFor();
  await card('Por setor').getByText('Cozinha').waitFor();
  await card('Por produto').locator('tbody tr').first().waitFor();
  await shot('07-times', true);
  await page.getByRole('radio', { name: 'Outro' }).click();
  await page.getByLabel('De', { exact: true }).fill('2025-01-01');
  await page.getByText(/escolha um período de até 120 dias/).waitFor();
});

await step('cashier has no reports; manager sees only their unit', async () => {
  await page.context().clearCookies();
  await login('caixa@demo.local');
  await page.goto(`${WEB}/relatorios/vendas`);
  await page.getByText('Acesso não permitido').waitFor();
  await page.context().clearCookies();
  await login('gerente@demo.local');
  await page.goto(`${WEB}/painel`);
  await card('Faturamento').waitFor();
  if (await page.getByRole('radio', { name: 'Todas as unidades' }).count())
    throw new Error('network for manager');
});

await browser.close();
console.log(results.join('\n'));
// Expected: 401 of the session check on the login page (no refresh cookie).
const unexpected = errors.filter((e) => !/HTTP 401 /.test(e) && !/status of 401/.test(e));
console.log(`\nErros HTTP/console: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 20)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
