// Cash register, payments, pre-bill and table operations walkthrough (feat/tables-pos),
// against the production build and a fresh demo seed (`pnpm db:seed`).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BROWSER } from './browser.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });
const WEB = 'http://localhost:3000';
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
    await page.screenshot({ path: path.join(OUT, `pos-fail-${results.length}.png`) });
    for (let i = 0; i < 3; i++) await closeDialog().catch(() => {});
  }
};

const browser = await chromium.launch({
  ...BROWSER,
  args: ['--disable-gpu', '--disable-extensions', '--renderer-process-limit=1'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
});
// Printing: the browser dialog is replaced by the "afterprint" event (D012 prints via window.print).
let prints = 0;
await context.exposeFunction('__printed', () => prints++);
await context.addInitScript(() => {
  window.print = () => {
    window.__printed();
    setTimeout(() => window.dispatchEvent(new Event('afterprint')), 20);
  };
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
const shot = (name) => page.screenshot({ path: path.join(OUT, `pos-${name}.png`) });
const dialog = (name) => page.getByRole('dialog', { name });
const table = (name) => page.getByRole('button', { name: new RegExp(`^${name}\\s`) });

/** Closes the top dialog and waits for its closing animation (a quick second Escape is lost). */
async function closeDialog() {
  const open = await page.evaluate(() => document.querySelectorAll('[role=dialog]').length);
  if (!open) return;
  await page.keyboard.press('Escape');
  await page.waitForFunction((n) => document.querySelectorAll('[role=dialog]').length < n, open, {
    timeout: 5_000,
  });
}

async function login(email) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}
/** Closes every open dialog (some may still be animating out). */
async function closeAll() {
  for (let i = 0; i < 6; i++) {
    const open = await page.evaluate(() => document.querySelectorAll('[role=dialog]').length);
    if (!open) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
}

async function logout() {
  await closeAll();
  await page.getByRole('button', { name: 'Menu do usuário' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await page.waitForURL('**/login');
}

await step('cashier: register page in blind mode with movements', async () => {
  await login('caixa@demo.local');
  await page.getByRole('link', { name: 'Caixa' }).click();
  await page.waitForURL('**/caixa');
  await page.getByText('Fechamento cego: os valores esperados ficam ocultos').waitFor();
  await page.getByText(/Suprimento · .* · Reforço de troco/).waitFor();
  await shot('01-register');
});

await step('withdrawal with F9 needs a reason', async () => {
  await page.keyboard.press('F9');
  const d = dialog('Sangria');
  await d.getByLabel('Valor').fill('1500');
  await d.getByRole('button', { name: 'Registrar' }).click();
  await d.getByText('Informe o motivo').waitFor();
  await d.getByLabel('Motivo').fill('Depósito no cofre');
  await d.getByRole('button', { name: 'Registrar' }).click();
  await toast('Movimentação registrada: sangria');
  await page.getByText(/Sangria · .* · Depósito no cofre/).waitFor();
});

await step('receive a tab: even split, cash with change, PIX QR and close', async () => {
  await page.keyboard.press('F2');
  await page.keyboard.type('Fernanda');
  await page.keyboard.press('Enter');
  const d = dialog(/Receber · #\d+ · Mesa 2 \+ 3 · Fernanda/);
  await d.waitFor();
  await d.getByLabel('Número de pessoas').fill('2');
  const shares = d.getByRole('button', { name: /^R\$/ });
  await shares.first().click();
  await d.getByLabel('Valor recebido').fill('5000');
  await d.getByText(/Troco: R\$/).waitFor();
  await shot('02-payment-cash');
  await d.getByRole('button', { name: /Registrar pagamento/ }).click();
  await toast(/Pagamento registrado · troco R\$/);
  await page.keyboard.press('2'); // PIX
  await d.getByRole('img', { name: 'QR Code PIX' }).waitFor();
  await shot('03-payment-pix');
  await d.getByRole('button', { name: /Confirmar PIX recebido/ }).click();
  await toast('Pagamento registrado');
  await d.getByText('Conta paga').waitFor();
  await d.getByRole('button', { name: 'Fechar conta' }).click();
  await toast('Conta fechada');
});

await step('delivery receivable is listed and received', async () => {
  await page.getByRole('button', { name: 'Receber', exact: true }).first().click();
  const d = dialog(/Receber · #\d+/);
  await d.getByRole('radio', { name: /Dinheiro/ }).waitFor();
  await d.getByRole('button', { name: /Registrar pagamento/ }).click();
  await toast('Pagamento registrado');
  await closeDialog();
  await page.getByText('Delivery a receber').waitFor({ state: 'detached' });
});

await step('tables: pre-bill prints and marks the table as waiting for payment', async () => {
  await page.getByRole('link', { name: 'Mesas' }).click();
  await table('2').click();
  await page.getByRole('button', { name: 'Pré-conta' }).click();
  const d = dialog('Pré-conta · Mesa 2');
  await d.getByText('PRÉ-CONTA', { exact: true }).waitFor();
  await d.getByText('Serviço 10% (opcional)').first().waitFor();
  await shot('04-pre-bill');
  const before = prints;
  await d.getByRole('button', { name: 'Imprimir pré-conta' }).click();
  for (let i = 0; i < 20 && prints === before; i++) await page.waitForTimeout(100);
  if (prints === before) throw new Error('print not called');
  await closeDialog();
  await closeDialog();
  await table('2').getByText('Aguardando pagamento').waitFor();
  await shot('05-tables-billing');
});

await step('split by items: part of a line goes to a new tab', async () => {
  await table('2').click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Carlos/ })
    .click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'Histórico' });
  await sheet.getByRole('button', { name: 'Dividir por itens' }).click();
  const d = dialog(/Dividir por itens/);
  await d.getByRole('button', { name: 'Mais Chope 300 ml' }).click();
  await d.getByLabel('Nome da nova conta').fill('Bia');
  await d.getByRole('button', { name: 'Transferir itens' }).click();
  await toast(/Itens transferidos para a conta #\d+/);
  await closeDialog();
  // Fernanda's tab was closed: Carlos + the new tab (the table still waits for payment).
  await table('2').getByText('Aguardando pagamento').waitFor();
  await table('2').click();
  await page.getByRole('dialog').getByRole('button', { name: /Bia/ }).waitFor();
  await closeDialog();
});

await step('tables: transfer a tab, change, merge and split tables', async () => {
  await table('2').click();
  await page.getByRole('dialog').getByRole('button', { name: /Bia/ }).click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'Histórico' });
  await sheet.getByRole('button', { name: 'Transferir mesa' }).click();
  const t = dialog(/Transferir conta/);
  await t.getByRole('button', { name: /^5\s*Livre/ }).click();
  await t.getByRole('button', { name: 'Transferir' }).click();
  await toast('Conta transferida para a mesa 5');
  await closeDialog();

  await table('5').click();
  await page.getByRole('button', { name: 'Trocar mesa' }).click();
  await dialog('Trocar a mesa 5')
    .getByRole('button', { name: /^6\s*Livre/ })
    .click();
  await dialog('Trocar a mesa 5').getByRole('button', { name: 'Trocar mesa' }).click();
  await toast('Mesa trocada');
  await closeDialog();
  await table('5').getByText('Livre').waitFor();

  await table('6').click();
  await page.getByRole('button', { name: 'Juntar mesas' }).click();
  await dialog('Juntar à mesa 6')
    .getByRole('button', { name: /^7\s*Ocupada/ })
    .click();
  await dialog('Juntar à mesa 6').getByRole('button', { name: 'Juntar mesas' }).click();
  await toast('Mesas juntadas');
  await page.getByRole('dialog', { name: /Mesa 6 \+ 7|Mesa 7 \+ 6/ }).waitFor();
  await shot('06-merged');
  await page.getByRole('button', { name: 'Separar' }).click();
  const s = dialog('Separar mesas');
  await s.getByLabel('Mesa que sai').click();
  await page.getByRole('option', { name: 'Mesa 7' }).click();
  await s.getByRole('checkbox').first().click();
  await s.getByRole('button', { name: 'Separar' }).click();
  await toast('Mesas separadas');
  await closeDialog();
  // Both tables stay occupied, each with its tabs ("1 conta", "2 contas").
  await table('7')
    .getByText(/\d+ contas?/)
    .waitFor();
  await table('6')
    .getByText(/\d+ contas?/)
    .waitFor();
});

await step('closing: blind count, difference shown after confirming, report printed', async () => {
  await page.getByRole('link', { name: 'Caixa' }).click();
  await page.getByRole('button', { name: 'Fechar caixa' }).click();
  const d = dialog('Fechar caixa');
  await d.getByText('Fechamento cego').waitFor();
  if (await d.getByText('Esperado:').count())
    throw new Error('expected amount shown in blind mode');
  await d.getByLabel('Contado em Dinheiro').fill('20000');
  await d.getByLabel('Contado em PIX').fill('3730');
  await d.getByRole('button', { name: 'Confirmar fechamento' }).click();
  const result = dialog('Caixa fechado');
  await result.getByText('Diferença total').waitFor();
  await result.getByRole('cell', { name: 'Dinheiro' }).waitFor();
  await shot('07-closing-result');
  const before = prints;
  await result.getByRole('button', { name: 'Imprimir relatório' }).click();
  for (let i = 0; i < 30 && prints === before; i++) await page.waitForTimeout(100);
  if (prints === before) throw new Error('report not printed');
  await result.getByRole('button', { name: 'Concluir' }).click();
  await page.getByText('Seu caixa está fechado').waitFor();
});

await step('register closed: payments in cash are refused, waiter cannot receive', async () => {
  await page.getByRole('link', { name: 'Pedidos' }).click();
  await page
    .locator('article')
    .filter({ hasText: 'Cartão de débito' })
    .getByRole('button', { name: /^Pedido/ })
    .click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'Histórico' });
  await sheet.getByRole('button', { name: /^Receber/ }).click();
  await page.getByText('Abra o seu caixa para receber em dinheiro').waitFor();
  await closeDialog();
  await closeDialog();
  await logout();
  await login('garcom@demo.local');
  if (await page.getByRole('link', { name: 'Caixa' }).count())
    throw new Error('Caixa visible to waiter');
  await page.goto(`${WEB}/caixa`);
  await page.getByText('Acesso não permitido').waitFor();
  await logout();
});

await step('manager: day registers, reopen with reason, refund an app payment', async () => {
  await login('gerente@demo.local');
  await page.goto(`${WEB}/caixa`);
  const carla = page.getByRole('listitem').filter({ hasText: 'Carla Caixa' });
  const bruno = page.getByRole('listitem').filter({ hasText: 'Bruno Gerente' });
  await bruno.getByText(/R\$\s2,50/).waitFor(); // seeded difference
  await shot('08-day-registers');
  await carla.getByRole('button', { name: 'Reabrir' }).click();
  const r = page.getByRole('dialog', { name: /Reabrir o caixa/ });
  await r.getByLabel('Motivo').fill('Recontagem do dinheiro');
  await r.getByRole('button', { name: 'Reabrir caixa' }).click();
  await toast('Caixa reaberto');
  // Shift change: the manager closes Carla's register (and sees the expected amounts).
  await carla.getByRole('button', { name: 'Fechar' }).click();
  const close = dialog('Fechar caixa');
  await close
    .getByText(/Esperado: R\$/)
    .first()
    .waitFor();
  await close.getByRole('button', { name: 'Confirmar fechamento' }).click();
  await dialog('Caixa fechado').getByRole('button', { name: 'Concluir' }).click();
  await carla.getByRole('button', { name: 'Reabrir' }).waitFor();

  await page.goto(`${WEB}/pedidos`);
  await page
    .locator('article')
    .filter({ hasText: 'iFood' })
    .getByRole('button', { name: /^Pedido/ })
    .click();
  const sheet = page.getByRole('dialog').filter({ hasText: 'Histórico' });
  await sheet.getByText('Pagamento online').first().waitFor();
  await sheet.getByRole('button', { name: /^Pagamentos/ }).click();
  const p = dialog(/Receber · #\d+/);
  await p.getByRole('button', { name: /Estornar Pagamento online/ }).click();
  const confirm = page.getByRole('dialog', { name: /Estornar Pagamento online/ });
  await confirm.getByLabel('Motivo').fill('Pedido cancelado no app');
  await confirm.getByRole('button', { name: 'Estornar' }).click();
  await toast('Pagamento estornado');
  await closeDialog(); // payment dialog
  await closeDialog(); // order sheet
});

await step('owner: PIX key with test QR Code and blind close setting', async () => {
  await logout();
  await login('dono@demo.local');
  await page.goto(`${WEB}/configuracoes/empresa`);
  await page.getByText('Fechamento de caixa cego').waitFor();
  const key = page.getByLabel('Chave', { exact: true });
  await key.waitFor();
  if ((await key.inputValue()) !== 'pix@demo.local') throw new Error('PIX key');
  await page.getByRole('img', { name: 'QR Code PIX' }).waitFor();
  await key.fill('invalida');
  await page.getByRole('button', { name: 'Salvar PIX' }).click();
  await page.getByText('Chave PIX inválida para o tipo').waitFor();
  await key.fill('pix@demo.local');
  await page.getByRole('button', { name: 'Salvar PIX' }).click();
  await toast('Chave PIX salva');
  await page.getByRole('img', { name: 'QR Code PIX' }).scrollIntoViewIfNeeded();
  await shot('09-pix-settings');
});

await step('dark theme and mobile register', async () => {
  await page.goto(`${WEB}/caixa`);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.getByText('Caixas do dia').waitFor();
  await shot('10-register-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('Caixas do dia').waitFor();
  await shot('11-register-mobile');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('page scrolls horizontally on mobile');
});

await browser.close();
console.log(results.join('\n'));
// Expected: 400/409 from the validations exercised above; 401 from the session check on the
// login page (no refresh cookie yet).
const unexpected = errors.filter(
  (e) => !/HTTP 4(00|09) /.test(e) && !/auth\/refresh|status of 401/.test(e),
);
console.log(`\nErros HTTP/console: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 20)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
