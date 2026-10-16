// Dispatch map walkthrough (feat/dispatch, D048) against the production build and the demo seed:
// pins, assembling a run, suggested order, reordering by keyboard, F9, marking an order without
// location, dragging a pin, the simulated courier, phone layout and permissions.
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
    await page.screenshot({
      path: path.join(OUT, `dispatch-fail-${results.length}.png`),
      fullPage: true,
    });
  }
};

const browser = await chromium.launch({ ...BROWSER, args: ['--disable-gpu'] });
const errors = [];
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
});
page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));
page.on(
  'response',
  (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`),
);

const shot = (name, full = false) =>
  page.screenshot({ path: path.join(OUT, `dispatch-${name}.png`), fullPage: full });

async function login(email) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

const map = () => page.getByRole('region', { name: 'Mapa do despacho' });
const list = () => page.getByRole('complementary', { name: 'Saída e pedidos' });
const readyRow = (name) => list().locator('li').filter({ hasText: name }).first();
const pin = (label) => map().getByLabel(label);

await step('cashier opens the dispatch: store, ready pins, couriers, mark on the map', async () => {
  await login('caixa@demo.local');
  await page.goto(`${WEB}/despacho`);
  await map().locator('canvas').waitFor({ timeout: 20_000 });
  await pin(/^Loja /).waitFor();
  await list()
    .getByRole('heading', { name: /Prontos/ })
    .waitFor();
  await readyRow('Bruna Ribeiro').waitFor();
  await readyRow('Mariana Souza').waitFor();
  // The library (Rua da Consolação) has no point in the seed: the operator marks it.
  const toMark = list().locator('li').filter({ hasText: 'Rua da Consolação' });
  await toMark.getByRole('button', { name: 'Marcar no mapa' }).waitFor();
  // Approximate address (street only) asks to check the pin.
  await readyRow('Bruna Ribeiro').getByText('Endereço aproximado: confira o pino').waitFor();
  await list().getByText('simulado', { exact: true }).first().waitFor();
  await page.waitForTimeout(1500); // tiles
  await shot('board');
});

await step('the simulated courier walks its loop on the map (labeled "simulado")', async () => {
  const courier = pin(/^Rui Moto \(simulado\), posição às/);
  await courier.waitFor({ timeout: 15_000 });
  const before = await courier.boundingBox();
  await page.waitForTimeout(3000);
  const after = await courier.boundingBox();
  if (before && after && before.x === after.x && before.y === after.y) {
    throw new Error('the simulated courier did not move');
  }
});

await step(
  'assemble a run: pins and list, suggested order with distance and arrivals',
  async () => {
    await pin(/^Pedido \d+, pronto/)
      .first()
      .waitFor();
    for (const name of ['Mariana Souza', 'Bruna Ribeiro', 'Carla Mendes']) {
      await readyRow(name).getByRole('checkbox').check();
    }
    await pin(/, 3º da saída$/).waitFor();
    await page.getByRole('button', { name: 'Sugerir ordem' }).click();
    await list()
      .getByText(/km · \d+ min até a última entrega/)
      .waitFor();
    await list()
      .getByText(/Chega por volta de \d{2}:\d{2}/)
      .first()
      .waitFor();
    await page.waitForTimeout(800);
    await shot('suggestion');
  },
);

await step('reorder by keyboard (handle + arrows): the arrivals are recalculated', async () => {
  const handles = list().getByRole('button', { name: /^Mover o pedido \d+ na ordem$/ });
  const first = (await handles.first().getAttribute('aria-label')).match(/\d+/)[0];
  await handles.first().focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForFunction(
    (n) =>
      document
        .querySelectorAll('[aria-label^="Mover o pedido"]')[1]
        ?.getAttribute('aria-label')
        ?.includes(`pedido ${n} `),
    first,
    { timeout: 5000 },
  );
  await list()
    .getByText(/km · \d+ min até a última entrega/)
    .waitFor();
});

await step('F9 dispatches with the chosen courier in the chosen order', async () => {
  await list()
    .getByRole('radiogroup', { name: 'Entregador' })
    .getByRole('radio', { name: /Helena Bike/ })
    .click();
  await page.keyboard.press('F9');
  await page.getByText('3 pedidos saíram com Helena Bike').waitFor();
  const helena = list().getByRole('listitem', { name: 'Entregador Helena Bike' });
  await helena.getByText(/Em rota · 3 de 3 a entregar/).waitFor();
  if (await readyRow('Mariana Souza').count()) throw new Error('order still in Prontos');
  await page.waitForTimeout(800);
  await shot('dispatched');
});

await step("simulated courier on Helena's run at 20×, then stopped", async () => {
  const helena = list().getByRole('listitem', { name: 'Entregador Helena Bike' });
  await helena.getByRole('button', { name: '20×' }).click();
  await pin(/^Helena Bike, posição às/).waitFor({ timeout: 10_000 });
  await helena.getByRole('button', { name: 'Parar simulação' }).click();
  await helena.getByRole('button', { name: '20×' }).waitFor();
});

await step(
  'order without location: marked by a click on the map, saved to the customer',
  async () => {
    const row = list().locator('li').filter({ hasText: 'Rua da Consolação' });
    await row.getByRole('button', { name: 'Marcar no mapa' }).click();
    await page.getByText(/Clique no mapa onde fica o pedido #\d+/).waitFor();
    const box = await map().boundingBox();
    await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.6);
    const dialog = page.getByRole('dialog', { name: 'Marcar o ponto de entrega?' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Salvar ponto' }).click();
    await page.getByText(/salvo, também no cadastro do cliente/).waitFor();
    await readyRow('Sofia Ramos').waitFor();
  },
);

await step('dragging a pin asks before moving it; "Voltar" keeps the old point', async () => {
  const target = pin(/^Pedido \d+, pronto/).first();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 8 });
  await page.mouse.up();
  const dialog = page.getByRole('dialog', { name: 'Mover o ponto de entrega?' });
  await dialog.waitFor();
  await shot('drag-dialog');
  await dialog.getByRole('button', { name: 'Voltar' }).click();
  await dialog.waitFor({ state: 'hidden' });
});

await step('the map follows the panel theme (light and dark styles, switched live)', async () => {
  const style = (name) =>
    page.waitForResponse((r) => r.url().endsWith(`/styles/${name}`) && r.ok(), {
      timeout: 15_000,
    });
  // The panel's theme menu (dark by default); the map switches without reloading.
  const setTheme = async (label) => {
    await page.getByRole('button', { name: /^Tema:/ }).click();
    await page.getByRole('menuitemradio', { name: label }).click();
  };
  const light = style('liberty');
  await setTheme('Claro');
  await light;
  await page.waitForTimeout(1500);
  await shot('light');
  const dark = style('dark');
  await setTheme('Escuro');
  await dark;
  // Lines are drawn again on the new style.
  await page.waitForTimeout(1500);
  await shot('dark');
});

await step('phone: Map and List tabs, no horizontal scroll', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Lista' }).click();
  await list().getByRole('heading', { name: 'Nova saída' }).waitFor();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  if (overflow) throw new Error('horizontal scroll on the phone');
  await shot('phone-list');
  await page.getByRole('tab', { name: 'Mapa' }).click();
  await map().locator('canvas').waitFor();
  await page.waitForTimeout(1000);
  await shot('phone-map');
  await page.setViewportSize({ width: 1440, height: 900 });
});

await step('waiter cannot open the dispatch', async () => {
  await page.context().clearCookies();
  await login('garcom@demo.local');
  await page.goto(`${WEB}/despacho`);
  await page.getByText('Acesso não permitido').waitFor();
});

await browser.close();
console.log(results.join('\n'));
// Expected: 401 of the session check on the login page (no refresh cookie).
const unexpected = errors.filter((e) => !/HTTP 401 /.test(e) && !/status of 401/.test(e));
console.log(`\nErros HTTP/console: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 20)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
