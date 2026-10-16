// Courier location sharing walkthrough (feat/dispatch phase 2, D049) against the production
// build and the demo seed: consent, GPS on the phone (simulated by the browser), the route map
// with "você", the position live on the cashier's dispatch map, stop and resume.
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
      path: path.join(OUT, `tracking-fail-${results.length}.png`),
      fullPage: true,
    });
  }
};

const browser = await chromium.launch({ ...BROWSER, args: ['--disable-gpu'] });
const errors = [];
const watch = (p, who) => {
  p.on('pageerror', (e) => errors.push(`${who} pageerror: ${e.message}`));
  p.on('console', (m) => m.type() === 'error' && errors.push(`${who} console: ${m.text()}`));
  p.on(
    'response',
    (r) =>
      r.status() >= 400 &&
      errors.push(`${who} HTTP ${r.status()} ${r.request().method()} ${r.url()}`),
  );
};

// Near the store (Av. Paulista), heading to the first stop.
const AT_STORE = { latitude: -23.5641, longitude: -46.6527 };
const ON_THE_WAY = { latitude: -23.5602, longitude: -46.6548 };

const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'pt-BR',
  isMobile: true,
  hasTouch: true,
  permissions: ['geolocation'],
  geolocation: { ...AT_STORE, accuracy: 15 },
});
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
page = await phone.newPage();
watch(page, 'celular');
const cashier = await desk.newPage();
watch(cashier, 'caixa');

async function login(p, email) {
  await p.goto(`${WEB}/login`);
  await p.getByLabel('E-mail').fill(email);
  await p.getByLabel('Senha').fill(PASSWORD);
  await p.getByRole('button', { name: 'Entrar' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

const location = () => page.getByRole('region', { name: 'Localização' });
const courierPin = () =>
  cashier
    .getByRole('region', { name: 'Mapa do despacho' })
    .getByLabel(/^Gustavo Motoboy, posição às/);

await step('courier: the route opens with the sharing card, the map and the notices', async () => {
  await login(page, 'entregador@demo.local');
  await page.goto(`${WEB}/entregas`);
  await location().getByText('Localização desligada').waitFor();
  await page.getByRole('region', { name: 'Mapa da sua rota' }).locator('canvas').waitFor();
  await page
    .getByText(/Chegada prevista por volta de \d{2}:\d{2}/)
    .first()
    .waitFor();
  await page.screenshot({ path: path.join(OUT, 'tracking-phone-off.png'), fullPage: true });
});

await step('consent: what, when, why, who and how long, before the first position', async () => {
  await location().getByRole('button', { name: 'Compartilhar localização' }).click();
  const dialog = page.getByRole('dialog', { name: /Compartilhar sua localização com/ });
  await dialog.getByText(/apagadas depois de 7 dias/).waitFor();
  await dialog.getByText(/O cliente não vê sua posição/).waitFor();
  await page.screenshot({ path: path.join(OUT, 'tracking-consent.png') });
  await dialog.getByRole('button', { name: 'Concordo e compartilhar' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await location()
    .getByText(/Localização compartilhada com/)
    .waitFor({ timeout: 15_000 });
  await location()
    .getByText(/Último envio às \d{2}:\d{2}/)
    .waitFor({ timeout: 20_000 });
  await page.getByRole('region', { name: 'Mapa da sua rota' }).getByLabel('Você').waitFor();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(OUT, 'tracking-phone-on.png'), fullPage: true });
});

await step('cashier: the courier appears where the phone is, and follows it', async () => {
  await login(cashier, 'caixa@demo.local');
  await cashier.goto(`${WEB}/despacho`);
  await courierPin().waitFor({ timeout: 20_000 });
  const before = await courierPin().boundingBox();
  await phone.setGeolocation({ ...ON_THE_WAY, accuracy: 15 });
  // The phone sends every 10 s; the map moves without reloading.
  await cashier.waitForFunction(
    (y) => {
      const el = [...document.querySelectorAll('[aria-label^="Gustavo Motoboy, posição às"]')][0];
      return el && Math.abs(el.getBoundingClientRect().y - y) > 5;
    },
    before.y,
    { timeout: 30_000 },
  );
  await cashier.waitForTimeout(800);
  await cashier.screenshot({ path: path.join(OUT, 'tracking-dispatch.png') });
});

await step(
  'stop sharing; reopening keeps it off, and turning on again needs no new consent',
  async () => {
    await location().getByRole('button', { name: 'Parar localização' }).click();
    await location().getByText('Localização desligada').waitFor();
    await page.reload();
    await location().getByText('Localização desligada').waitFor();
    await location().getByRole('button', { name: 'Compartilhar localização' }).click();
    await location()
      .getByText(/Localização compartilhada com/)
      .waitFor({ timeout: 15_000 });
    if (await page.getByRole('dialog').count()) throw new Error('asked for consent again');
    // Left on: reopening the page during the route resumes by itself.
    await page.reload();
    await location()
      .getByText(/Localização compartilhada com/)
      .waitFor({ timeout: 15_000 });
    await location().getByRole('button', { name: 'Parar localização' }).click();
  },
);

// Positions never reach the couriers' sockets: covered by tracking.e2e.test.ts.
await browser.close();
console.log(results.join('\n'));
// Expected: 401 of the session check on the login page (no refresh cookie).
const unexpected = errors.filter((e) => !/HTTP 401 /.test(e) && !/status of 401/.test(e));
console.log(`\nErros HTTP/console: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 20)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
