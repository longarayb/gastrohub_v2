// New order with the keyboard only (feat/redesign, phase C): no click after signing in.
// Against the production build (pnpm start:lite) and a fresh seed.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BROWSER } from './browser.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });
const WEB = 'http://localhost:3000';
const results = [];
const errors = [];
let page;

const step = async (name, fn) => {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    const lines = e.message.split('\n').slice(0, process.env.DEBUG ? 12 : 1);
    results.push(`FAIL  ${name}: ${lines.join(' | ')} @ ${page.url()}`);
    await page.screenshot({ path: path.join(OUT, `keyboard-fail-${results.length}.png`) });
  }
};
const shot = (name) => page.screenshot({ path: path.join(OUT, `keyboard-${name}.png`) });
const focused = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute('aria-label') ?? el?.id ?? el?.tagName ?? '';
  });

const browser = await chromium.launch({ ...BROWSER, args: ['--disable-gpu'] });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
});
page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.url()}`));

await page.goto(`${WEB}/login`);
await page.getByLabel('E-mail').fill('caixa@demo.local');
await page.getByLabel('Senha').fill('Demo1234');
await page.keyboard.press('Enter');
await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });

await step(
  'new order opens with the focus on the product search and the shortcuts shown',
  async () => {
    await page.goto(`${WEB}/pedidos/novo`);
    await page.getByLabel('Buscar produto').waitFor();
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === 'Buscar produto',
    );
    const bar = page.getByLabel('Atalhos de teclado');
    for (const key of ['F2', 'F6', 'F7', 'F9']) await bar.getByText(key, { exact: true }).waitFor();
    // The bar says what F9 does here.
    await bar.getByText('Criar pedido').waitFor();
    if (await bar.getByText('F4', { exact: true }).count()) throw new Error('F4 on this screen');
  },
);

await step(
  'type, ↓ and Enter open a product; F9 adds it; the focus goes back to the search',
  async () => {
    await page.keyboard.type('agua');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: /Água mineral/ });
    await dialog.waitFor();
    await page.keyboard.press('+'); // quantity 2
    // A screen that just opened ignores F9 for 1 s (cooldown): a person is never this fast.
    await page.waitForTimeout(1100);
    await dialog
      .getByRole('group', { name: 'Quantidade' })
      .getByText('2', { exact: true })
      .waitFor();
    await page.keyboard.press('F9');
    await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(
      () => document.activeElement?.getAttribute('aria-label') === 'Buscar produto',
    );
    await page.getByRole('region', { name: 'Itens do pedido' }).getByText('2×').waitFor();
  },
);

await step(
  'a product with complements: options with Tab/Space, note with F7, Ctrl+Enter adds',
  async () => {
    await page.keyboard.press('F2');
    await page.keyboard.type('x-burguer');
    await page.keyboard.press('Enter'); // only result
    const dialog = page.getByRole('dialog', { name: /X-Burguer/ });
    await dialog.waitFor();
    // The dialog opens on the first option (Bacon): Space picks it (it gets a quantity).
    const onOption = await page.evaluate(() =>
      document.activeElement?.hasAttribute('aria-pressed'),
    );
    if (!onOption) throw new Error('the dialog did not start on an option');
    await page.keyboard.press('Space');
    await dialog.getByRole('group', { name: 'Bacon' }).waitFor();
    // The required "ponto da carne": Tab until "Ao ponto", Space picks it.
    for (let i = 0; i < 25; i++) {
      const text = await page.evaluate(() => document.activeElement?.textContent ?? '');
      if (text.startsWith('Ao ponto')) break;
      await page.keyboard.press('Tab');
    }
    await page.keyboard.press('Space');
    // X-Burguer R$ 29,90 + bacon R$ 5,00.
    await dialog.getByRole('button', { name: /^Adicionar · R\$\s34,90/ }).waitFor();
    await page.keyboard.press('F7');
    if (!(await focused()).length) throw new Error('F7 did not focus the note');
    await page.keyboard.type('sem cebola');
    await page.waitForTimeout(1100); // 1 s after the previous confirmation
    await page.keyboard.press('Control+Enter');
    await dialog.waitFor({ state: 'detached' });
    await page
      .getByRole('region', { name: 'Itens do pedido' })
      .getByText(/X-Burguer/)
      .waitFor();
    await shot('01-cart');
  },
);

let created = null;
await step('F7 order note; F9 pressed twice creates ONE order (cooldown)', async () => {
  await page.keyboard.press('F7');
  await page.keyboard.type('Cliente aguardando no balcão');
  // The item was confirmed a moment ago: let the 1 s cooldown pass, then a double press.
  await page.waitForTimeout(1100);
  await page.keyboard.press('F9');
  await page.keyboard.press('F9');
  const toast = page.getByText(/Pedido #\d+ criado/);
  await toast.first().waitFor();
  await page.waitForURL('**/pedidos');
  await page.waitForTimeout(1500);
  if ((await toast.count()) !== 1) throw new Error(`${await toast.count()} orders created`);
  created = Number((await toast.first().innerText()).match(/#(\d+)/)[1]);
});

await step(
  'cash: F2 finds the order, F4 opens the payment; F9 twice pays and does NOT close the tab',
  async () => {
    await page.goto(`${WEB}/caixa`);
    await page.getByLabel('Buscar pedido ou mesa').waitFor();
    const bar = page.getByLabel('Atalhos de teclado');
    for (const key of ['F2', 'F4', 'F8']) await bar.getByText(key, { exact: true }).waitFor();
    await page.keyboard.press('F2');
    await page.keyboard.type(String(created));
    await page.keyboard.press('F4');
    const dialog = page.getByRole('dialog', { name: new RegExp(`Receber · #${created}`) });
    await dialog.waitFor();
    await dialog.getByText('F9', { exact: true }).first().waitFor();
    // The dialog just opened: an F9 now is ignored (it could be the screen's leftover press).
    await page.waitForTimeout(1100);
    await page.keyboard.press('F9'); // registers the payment (cash, the whole balance)
    await page.keyboard.press('F9'); // too soon: must NOT confirm the next action (close)
    await dialog.getByText('Conta paga').waitFor();
    await page.waitForTimeout(1500);
    if (!(await dialog.isVisible())) throw new Error('the second F9 closed the tab');
    const payments = page.getByText(/Pagamento registrado/);
    if ((await payments.count()) !== 1) throw new Error(`${await payments.count()} payments`);
    // After the cooldown, F9 confirms the next action (the handover), if allowed here.
    const close = dialog.getByRole('button', { name: /Confirmar retirada|Fechar conta/ });
    if (await close.isVisible()) {
      await page.keyboard.press('F9');
      await dialog.waitFor({ state: 'detached' });
    }
    await shot('02-cash');
  },
);

await step('F6 goes to the order type (← → change it), Tab to the table (dine-in)', async () => {
  await page.goto(`${WEB}/pedidos/novo`);
  await page.getByLabel('Buscar produto').waitFor();
  await page.keyboard.press('F6');
  await page.keyboard.press('ArrowRight'); // Balcão → Delivery
  await page.getByRole('tab', { name: 'Delivery', selected: true }).waitFor();
  await page.keyboard.press('ArrowRight'); // Delivery → Mesa
  await page.getByRole('tab', { name: 'Mesa', selected: true }).waitFor();
  await page.keyboard.press('Tab');
  if ((await focused()) !== 'Mesa') throw new Error(`focus on ${await focused()}`);
});

await step('"?" shows the keyboard map, the same on every screen', async () => {
  // Outside a text field (in a field, ? is just typed).
  await page.evaluate(() => document.activeElement?.blur?.());
  await page.keyboard.press('?');
  const map = page.getByRole('dialog', { name: 'Atalhos de teclado' });
  await map.waitFor();
  await map.getByText('Confirmar a ação principal').waitFor();
  await page.keyboard.press('Escape');
});

await browser.close();
console.log(results.join('\n'));
const unexpected = errors.filter((e) => !/HTTP 401 /.test(e));
console.log(`\nErros HTTP/console: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 10)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
