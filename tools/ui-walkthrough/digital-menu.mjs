// Digital menu walkthrough (feat/digital-menu): the customer's phone on a slow network (menu,
// item builder, pizza, checkout, tracking in realtime, PIX "Já paguei"), the restaurant panel
// (accept, refuse with a customer reason, settings) and a closed store.
// Against `pnpm start:lite --menu` and a fresh demo seed (`pnpm db:seed`).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });
const WEB = 'http://localhost:3000';
const MENU = 'http://localhost:3001';
const API = 'http://localhost:3333/api';
const PASSWORD = 'Demo1234';
const results = [];
const notes = [];
let page;

const step = async (name, fn) => {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    const lines = e.message.split('\n').slice(0, process.env.DEBUG ? 12 : 1);
    results.push(`FAIL  ${name}: ${lines.join(' | ')} @ ${page.url()}`);
    await page.screenshot({ path: path.join(OUT, `menu-fail-${results.length}.png`) });
  }
};

async function apiLogin(email) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return (await res.json()).accessToken;
}
async function apiCall(token, method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--disable-gpu', '--disable-extensions', '--renderer-process-limit=1'],
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

// The customer's phone.
const phone = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'pt-BR',
});
page = await phone.newPage();
watch(page, 'menu');
// Rejected order submissions: print the API message (helps when a step fails).
page.on('response', async (r) => {
  if (r.request().method() === 'POST' && r.url().endsWith('/orders') && r.status() >= 400) {
    notes.push(`envio do pedido recusado (${r.status()}): ${await r.text().catch(() => '')}`);
  }
});
const toast = (p, text) =>
  p.locator('[data-sonner-toast]', { hasText: text }).first().waitFor({ timeout: 10_000 });
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `menu-${name}.png`) });

const manager = await apiLogin('gerente@demo.local');
// Always open during the walkthrough (the closed state is checked at the end).
await apiCall(manager, 'PUT', '/stores/current/hours', { hours: [] });
await new Promise((r) => setTimeout(r, 2500)); // the API refreshes the menu cache (debounced)

await step('first load on a slow mobile network (3G): server-rendered, light', async () => {
  const cdp = await phone.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  });
  let scriptBytes = 0;
  const onResponse = async (r) => {
    // Bytes on the wire (compressed), what a 3G connection actually downloads.
    if (r.request().resourceType() === 'script') {
      const sizes = await r
        .request()
        .sizes()
        .catch(() => null);
      scriptBytes += sizes?.responseBodySize ?? 0;
    }
  };
  page.on('response', onResponse);
  const started = Date.now();
  await page.goto(`${MENU}/demo`, { waitUntil: 'load' });
  const loadMs = Date.now() - started;
  const lcp = await page.evaluate(
    () =>
      new Promise((resolve) => {
        new PerformanceObserver((list) => {
          const entries = list.getEntries();
          resolve(Math.round(entries[entries.length - 1].startTime));
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        setTimeout(() => resolve(-1), 3000);
      }),
  );
  page.off('response', onResponse);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
  notes.push(
    `3G simulado: LCP ${lcp} ms · load ${loadMs} ms · JS transferido (comprimido) ${Math.round(scriptBytes / 1024)} KB`,
  );
  if (lcp < 0 || lcp > 4000) throw new Error(`LCP ${lcp} ms acima de 4 s`);
});

await step('restaurant brand, not ours: name, color, open, categories', async () => {
  await page.getByRole('heading', { name: 'GastroHub Demo', level: 1 }).waitFor();
  await page.getByRole('status').filter({ hasText: 'Aberto agora' }).waitFor();
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  );
  if (primary.toLowerCase() !== '#c2410c') throw new Error(`--primary = ${primary}`);
  await page
    .getByRole('navigation', { name: 'Categorias' })
    .getByRole('link', { name: 'Pizzas' })
    .waitFor();
  await page.getByText(/^feito com /).waitFor();
  await shot(page, '01-home');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('page scrolls horizontally');
});

await step('item builder: required complement, then add', async () => {
  await page.getByRole('button', { name: 'X-Burguer', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('heading', { name: 'X-Burguer' }).waitFor();
  await sheet.getByRole('button', { name: /^Adicionar/ }).click();
  await sheet.getByRole('alert').waitFor();
  await sheet.getByRole('radio', { name: /Ao ponto/ }).click();
  await sheet.getByRole('checkbox', { name: /Bacon/ }).click();
  await shot(page, '02-item');
  await sheet.getByRole('button', { name: /^Adicionar · R\$/ }).click();
  await sheet.waitFor({ state: 'detached' });
});

await step('pizza: size and two flavors', async () => {
  await page
    .getByRole('region', { name: 'Pizzas' })
    .getByRole('button', { name: 'Montar pizza' })
    .click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('radio', { name: /Grande/ }).click();
  await sheet.getByRole('checkbox', { name: /^Calabresa/ }).click();
  await sheet.getByRole('checkbox', { name: /^Marguerita/ }).click();
  await sheet.getByRole('button', { name: /^Adicionar · R\$/ }).click();
  await sheet.waitFor({ state: 'detached' });
  await page.getByRole('button', { name: /Ver carrinho · 2 itens/ }).waitFor();
});

let trackingUrl;
await step('checkout: delivery area fee, PIX, privacy consent, order sent', async () => {
  await page.getByRole('button', { name: /Ver carrinho/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByText('½ Calabresa, ½ Marguerita').waitFor();
  await sheet.getByRole('button', { name: 'Continuar' }).click();
  await sheet.getByRole('radio', { name: 'Entrega' }).click();
  await sheet.getByLabel('Nome', { exact: true }).fill('Ana Cardápio');
  await sheet.getByLabel('Celular com DDD', { exact: true }).fill('11977776666');
  // Typed by hand (works without ViaCEP).
  await sheet.getByLabel('Número', { exact: true }).fill('300');
  await sheet.getByLabel('Rua', { exact: true }).fill('Rua Treze de Maio');
  await sheet.getByLabel('Bairro', { exact: true }).fill('Bixiga');
  await sheet.getByLabel('Cidade', { exact: true }).fill('São Paulo');
  await sheet.getByLabel('UF', { exact: true }).fill('SP');
  await sheet.getByLabel('CEP', { exact: true }).fill('01327000');
  await sheet
    .getByRole('region', { name: 'Resumo' })
    .getByText(/Entrega · Centro expandido/)
    .waitFor({ timeout: 15_000 });
  await sheet.getByRole('radio', { name: 'PIX' }).click();
  await sheet.getByRole('button', { name: /^Enviar pedido/ }).click();
  await sheet.getByText('Aceite o aviso de privacidade para continuar').waitFor();
  await sheet.getByRole('button', { name: 'aviso de privacidade' }).click();
  await page
    .getByRole('dialog', { name: 'Aviso de privacidade' })
    .getByText(/controlador/)
    .waitFor();
  await page.keyboard.press('Escape');
  await sheet.getByRole('checkbox', { name: /Li e aceito/ }).click();
  await shot(page, '03-checkout');
  await sheet.getByRole('button', { name: /^Enviar pedido/ }).click();
  await page.waitForURL(/\/demo\/pedido\//, { timeout: 15_000 });
  trackingUrl = page.url();
  await page.getByRole('status').filter({ hasText: 'Pedido recebido' }).waitFor();
  await page.getByText(/Previsão de entrega por volta das/).waitFor();
  await shot(page, '04-tracking-pending');
});

// The restaurant panel (desktop).
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
const panel = await desk.newPage();
watch(panel, 'panel');
async function panelLogin(email) {
  await panel.goto(`${WEB}/login`);
  await panel.waitForLoadState('networkidle');
  await panel.getByLabel('E-mail').fill(email);
  await panel.getByLabel('Senha').fill(PASSWORD);
  await panel.getByRole('button', { name: 'Entrar' }).click();
  await panel.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}
const column = (name) => panel.getByRole('region', { name });

await step(
  'panel: the menu order arrives pending; accepting updates the phone in realtime',
  async () => {
    await panelLogin('caixa@demo.local');
    const card = column('Pendente').locator('article').filter({ hasText: 'Ana Cardápio' });
    await card.getByText('Cardápio digital').waitFor({ timeout: 15_000 });
    await card.getByRole('button', { name: 'Aceitar' }).click();
    // The phone page updates without reload.
    await page
      .getByRole('status')
      .filter({ hasText: /Aceito pelo restaurante|Em preparo/ })
      .waitFor({ timeout: 15_000 });
    await page.getByRole('img', { name: 'QR Code do PIX' }).waitFor();
    await shot(page, '05-tracking-pix');
    await page.getByRole('button', { name: 'Já paguei' }).click();
    await toast(page, 'O restaurante vai conferir');
    await page.getByText(/Você avisou que pagou/).waitFor();
    await column('Aceito')
      .locator('article')
      .filter({ hasText: 'Ana Cardápio' })
      .getByText('PIX informado pelo cliente · conferir')
      .waitFor({ timeout: 15_000 });
    await panel.screenshot({ path: path.join(OUT, 'menu-06-panel-pix-reported.png') });
  },
);

await step('refusal: the customer sees only the reason meant for them', async () => {
  // A second order from the phone API (takeout), refused in the panel.
  const catalog = await (await fetch(`${API}/public/demo/catalog`)).json();
  const water = catalog.categories
    .flatMap((c) => c.products)
    .find((p) => p.name.startsWith('Água'));
  const items = [{ productId: water.id, quantity: 1 }];
  const preview = await (
    await fetch(`${API}/public/demo/cart`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'TAKEOUT', items }),
    })
  ).json();
  const created = await (
    await fetch(`${API}/public/demo/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'TAKEOUT',
        items,
        customer: { name: 'Bruno Trote', phone: '11966665555' },
        expectedPaymentMethod: 'CASH',
        acceptPrivacy: true,
        expectedTotalCents: preview.totalCents,
        formStartedAt: Date.now() - 20_000,
      }),
    })
  ).json();
  const card = column('Pendente').locator('article').filter({ hasText: 'Bruno Trote' });
  await card.getByRole('button', { name: /^Pedido \d+$/ }).click();
  const sheet = panel.getByRole('dialog').last();
  await sheet.getByRole('button', { name: 'Recusar' }).click();
  const d = panel.getByRole('dialog', { name: /^Recusar o pedido/ });
  await d.getByRole('radio', { name: 'Outro motivo' }).click();
  await d.getByLabel('Motivo que o cliente vai ver').fill('Fechamos a cozinha mais cedo hoje');
  await d.getByLabel(/Observação interna/).fill('Número suspeito de trote');
  await d.getByRole('checkbox', { name: /Bloquear este telefone/ }).click();
  await panel.screenshot({ path: path.join(OUT, 'menu-07-refuse.png') });
  await d.getByRole('button', { name: 'Recusar pedido' }).click();
  await toast(panel, 'Pedido recusado');
  const other = await phone.newPage();
  watch(other, 'menu2');
  await other.goto(`${MENU}/demo/pedido/${created.trackingToken}`);
  await other.getByText('Pedido não aceito: Fechamos a cozinha mais cedo hoje').waitFor();
  if (await other.getByText(/trote/i).count())
    throw new Error('internal note visible to the customer');
  await other.screenshot({ path: path.join(OUT, 'menu-08-refused.png') });
  await other.close();
});

await step('"Não é você?": clears the data saved on the phone', async () => {
  await page.goto(`${MENU}/demo`);
  await page.getByRole('link', { name: /Acompanhar o pedido #\d+/ }).waitFor();
  await page.getByRole('button', { name: 'Água mineral 500 ml', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /^Adicionar · R\$/ })
    .click();
  await page.getByRole('button', { name: /Ver carrinho/ }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Continuar' }).click();
  if ((await sheet.getByLabel('Nome', { exact: true }).inputValue()) !== 'Ana Cardápio')
    throw new Error('not prefilled');
  await sheet.getByRole('button', { name: 'Não é você? Limpar meus dados' }).click();
  await toast(page, 'Seus dados foram apagados deste aparelho');
  if ((await sheet.getByLabel('Nome', { exact: true }).inputValue()) !== '')
    throw new Error('name kept');
  await page.keyboard.press('Escape');
});

await step('panel: digital menu settings with link, QR and the legal-review warning', async () => {
  await panel.goto(`${WEB}/login`);
  await desk.clearCookies();
  await panelLogin('gerente@demo.local');
  await panel.goto(`${WEB}/configuracoes/cardapio-digital`);
  await panel.getByRole('img', { name: 'QR Code do cardápio' }).first().waitFor();
  await panel.getByText(/O texto abaixo é um/).waitFor();
  await panel.getByText(/de preferência com apoio jurídico/).waitFor();
  await panel
    .getByRole('list', { name: 'Telefones bloqueados' })
    .getByText('(11) 96666-5555')
    .waitFor();
  await panel.screenshot({ path: path.join(OUT, 'menu-09-settings.png'), fullPage: true });
});

await step('closed store: menu visible with the next opening, ordering blocked', async () => {
  const weekday = (new Date(Date.now() - 3 * 3_600_000).getUTCDay() + 2) % 7;
  await apiCall(manager, 'PUT', '/stores/current/hours', {
    hours: [{ weekday, opensAt: '11:00', closesAt: '15:00' }],
  });
  await new Promise((r) => setTimeout(r, 2500));
  await page.goto(`${MENU}/demo`);
  await page
    .getByRole('status')
    .filter({ hasText: /Fechado · abre .* às 11:00/ })
    .waitFor();
  await page.getByText(/Veja o cardápio e volte para pedir/).waitFor();
  await shot(page, '10-closed');
  await page.getByRole('button', { name: /Ver carrinho/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Pedidos indisponíveis agora' })
    .waitFor();
  await apiCall(manager, 'PUT', '/stores/current/hours', { hours: [] });
});

await step('link preview image of the restaurant', async () => {
  const og = await phone.newPage();
  const res = await og.goto(`${MENU}/demo/opengraph-image`);
  if (res.headers()['content-type'] !== 'image/png') throw new Error('not a PNG');
  await og.screenshot({ path: path.join(OUT, 'menu-11-og.png') });
  await og.close();
});

await browser.close();
console.log(results.join('\n'));
for (const n of notes) console.log(`NOTE  ${n}`);
// Expected: 400 from the validations exercised above; 401 from the panel session check.
const unexpected = errors.filter(
  (e) => !/HTTP 400 /.test(e) && !/auth\/refresh|status of 40[01]/.test(e),
);
console.log(`\nErros HTTP/console: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 20)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
