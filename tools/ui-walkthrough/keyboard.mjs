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
    for (const key of ['F2', 'F4', 'F6', 'F7', 'F9'])
      await bar.getByText(key, { exact: true }).waitFor();
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
    await page.keyboard.press('Control+Enter');
    await dialog.waitFor({ state: 'detached' });
    await page
      .getByRole('region', { name: 'Itens do pedido' })
      .getByText(/X-Burguer/)
      .waitFor();
    await shot('01-cart');
  },
);

await step('F7 order note, F9 creates the order, back to the board', async () => {
  await page.keyboard.press('F7');
  await page.keyboard.type('Cliente aguardando no balcão');
  await page.keyboard.press('F9');
  await page.getByText(/Pedido #\d+ criado/).waitFor();
  await page.waitForURL('**/pedidos');
});

await step('F4 changes the order type and F6 goes to the table field (dine-in)', async () => {
  await page.goto(`${WEB}/pedidos/novo`);
  await page.getByLabel('Buscar produto').waitFor();
  await page.keyboard.press('F4'); // Balcão → Delivery
  await page.keyboard.press('F4'); // Delivery → Mesa
  await page.getByRole('tab', { name: 'Mesa', selected: true }).waitFor();
  await page.keyboard.press('F6');
  if ((await focused()) !== 'Mesa') throw new Error(`focus on ${await focused()}`);
});

await browser.close();
console.log(results.join('\n'));
const unexpected = errors.filter((e) => !/HTTP 401 /.test(e));
console.log(`\nErros HTTP/console: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 10)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
