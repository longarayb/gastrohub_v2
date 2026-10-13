// Browser check of the local production rehearsal (KEEP=1 bash deploy/local-check.sh): the apps
// call /api on their own https address and real time goes through the proxy. Caddy's local
// certificates are accepted (ignoreHTTPSErrors).
import { chromium } from 'playwright-core';
import { BROWSER } from './browser.mjs';

const PORT = process.env.PORT ?? '8443';
const url = (app, path) => `https://${app}.localhost:${PORT}${path}`;
const results = [];
const errors = [];
let page;
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}: ${e.message.split('\n')[0]} @ ${page.url()}`);
  }
};

const browser = await chromium.launch({ ...BROWSER, args: ['--disable-gpu'] });
const context = await browser.newContext({ ignoreHTTPSErrors: true, locale: 'pt-BR' });
page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('response', (r) => {
  if (r.status() >= 400 && !/\/auth\/refresh/.test(r.url()))
    errors.push(`HTTP ${r.status()} ${r.url()}`);
  // Every API call must stay on the page's own address.
  if (/\/api\//.test(r.url()) && !r.url().startsWith(new URL(page.url()).origin)) {
    errors.push(`API fora do próprio endereço: ${r.url()}`);
  }
});

await step('panel: login as the demo owner, kanban with real time through the proxy', async () => {
  await page.goto(url('painel', '/login'));
  await page.getByLabel('E-mail').fill('dono@demo.local');
  await page.getByLabel('Senha').fill('Demo1234');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30_000 });
  await page.getByText('Ambiente de demonstração').waitFor();
  await page.goto(url('painel', '/pedidos'));
  await page.getByText('Tempo real').waitFor({ timeout: 30_000 });
});

await step('panel: reload keeps the session (refresh cookie on the same address)', async () => {
  await page.reload();
  await page.getByText('Tempo real').waitFor({ timeout: 30_000 });
  if (page.url().includes('/login')) throw new Error('sent back to login');
});

await step('panel: a blocked action shows the demo message', async () => {
  await page.goto(url('painel', '/configuracoes/empresa'));
  await page.getByLabel('Nome fantasia').fill('Mudado');
  await page
    .getByRole('button', { name: /Salvar/ })
    .first()
    .click();
  await page.getByText(/Indisponível no ambiente de demonstração/).waitFor();
});

await step('digital menu: the demo opens (server-side calls to the API)', async () => {
  await page.goto(url('cardapio', '/demo'));
  await page.getByRole('heading').first().waitFor();
});

await step('platform admin: login page loads its API through its own address', async () => {
  await page.goto(url('admin', '/login'));
  await page.getByLabel('E-mail').waitFor();
});

await browser.close();
console.log(results.join('\n'));
// 401: session probe before login; 403 on stores/current: the demo block tested above.
const unexpected = errors.filter(
  (e) => !/HTTP 401 /.test(e) && !/HTTP 403 .*\/api\/stores\/current$/.test(e),
);
console.log(`\nErros: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 10)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
