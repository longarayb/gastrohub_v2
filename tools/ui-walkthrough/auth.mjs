// Manual-style UI walkthrough of the auth/tenancy screens using the installed Edge.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Screenshots go to ./screenshots (gitignored).
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });
const WEB = 'http://localhost:3000';
const stamp = Date.now();
const owner = { email: `dono.ui.${stamp}@teste.com`, password: 'Senha1234' };
const waiter = { email: `garcom.ui.${stamp}@teste.com`, password: 'Senha1234' };

const results = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}: ${e.message.split('\n')[0]} @ ${page.url()}`);
    await page.screenshot({ path: path.join(OUT, `fail-${results.length}.png`), fullPage: false });
  }
};

// One headless browser, one page, no parallelism, lean flags (low commit memory on this machine).
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: [
    '--disable-gpu',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--renderer-process-limit=1',
    '--js-flags=--max-old-space-size=256',
  ],
});
const context = await browser.newContext({
  viewport: { width: 1366, height: 860 },
  locale: 'pt-BR',
});
const page = await context.newPage();
const consoleErrors = [];
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on(
  'response',
  (r) =>
    r.status() >= 400 &&
    consoleErrors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`),
);
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

const toast = (text) => page.getByText(text).first().waitFor({ timeout: 10_000 });
const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });

await step('unauthenticated root redirects to /login', async () => {
  await page.goto(WEB);
  await page.waitForURL('**/login', { timeout: 20_000 });
  await shot('01-login');
});

await step('brand name and colors come from BRAND', async () => {
  const title = await page.title();
  if (title !== 'GastroHub') throw new Error('title=' + title);
  const primary = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  );
  if (!primary.startsWith('oklch(0.64')) throw new Error('--primary=' + primary);
});

await step('register validation shows pt-BR errors', async () => {
  await page.goto(`${WEB}/cadastro`);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.getByText('Informe o nome do restaurante').waitFor();
  await page.getByLabel('CNPJ').fill('11222333000180');
  await page.getByLabel('CNPJ').blur();
  await page.getByText('CNPJ inválido').waitFor();
});

await step('register a restaurant (masks applied)', async () => {
  await page.getByLabel('Nome do restaurante').fill('Cantina UI Teste');
  await page.getByLabel('Razão social').fill('Cantina UI Teste LTDA');
  await page.getByLabel('CNPJ').fill('11222333000181');
  if ((await page.getByLabel('CNPJ').inputValue()) !== '11.222.333/0001-81')
    throw new Error('CNPJ mask');
  await page.getByLabel('Seu nome').fill('Maria Dona');
  await page.getByLabel('Celular').fill('11987654321');
  if ((await page.getByLabel('Celular').inputValue()) !== '(11) 98765-4321')
    throw new Error('phone mask');
  await page.getByLabel('E-mail').fill(owner.email);
  await page.getByLabel('Senha').fill(owner.password);
  await page.getByRole('button', { name: 'Criar conta' }).click();
  await page.waitForURL('**/configuracoes/empresa', { timeout: 20_000 });
  await page.getByText('Dados da empresa').first().waitFor();
});

await step('CEP lookup fills address and store data saves', async () => {
  await page.getByLabel('CEP').fill('01310100');
  await page.waitForFunction(
    () => document.querySelector('input[name="address.street"]')?.value.length > 0,
    null,
    { timeout: 15_000 },
  );
  const street = await page.locator('input[name="address.street"]').inputValue();
  if (!/Paulista/i.test(street)) throw new Error(`street=${street}`);
  await page.locator('input[name="address.number"]').fill('1000');
  await page.getByRole('button', { name: 'Salvar dados' }).click();
  await toast('Dados da empresa salvos');
});

await step('settings save (service fee 12%)', async () => {
  await page.getByLabel('Taxa de serviço no salão (%)').fill('12');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await toast('Configurações salvas');
});

await step('logo upload', async () => {
  // 1x1 PNG
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const file = path.join(OUT, 'logo.png');
  writeFileSync(file, png);
  await page.locator('input[type="file"]').setInputFiles(file);
  await toast('Logo atualizado');
  await page.locator('img[alt="Logo"]').waitFor();
  await shot('02-empresa');
});

await step('session survives a full reload (refresh cookie)', async () => {
  await page.reload();
  await page.getByText('Dados da empresa').first().waitFor({ timeout: 15_000 });
  const fee = await page.getByLabel('Taxa de serviço no salão (%)').inputValue();
  if (fee !== '12') throw new Error(`fee after reload=${fee}`);
  const number = await page.locator('input[name="address.number"]').inputValue();
  if (number !== '1000') throw new Error(`number after reload=${number}`);
});

await step('business hours: add Friday night shift and save', async () => {
  await page.getByRole('link', { name: 'Horários' }).click();
  await page.waitForURL('**/configuracoes/horarios');
  await page.getByText('Sexta-feira').waitFor();
  await page.getByRole('button', { name: 'Copiar para todos' }).first().waitFor();
  await page.getByRole('button', { name: 'Salvar horários' }).click();
  await toast('Horários salvos');
  await shot('03-horarios');
});

await step('create a waiter user', async () => {
  await page.getByRole('link', { name: 'Usuários' }).click();
  await page.waitForURL('**/configuracoes/usuarios');
  await page.getByRole('button', { name: 'Novo usuário' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill('João Garçom');
  await dialog.getByLabel('E-mail').fill(waiter.email);
  await dialog.getByLabel('Senha inicial').fill(waiter.password);
  await dialog.getByRole('button', { name: 'Adicionar' }).click();
  await toast('Usuário adicionado');
  await page.getByRole('cell', { name: /João Garçom/ }).waitFor();
  await shot('04-usuarios');
});

await step('dark mode toggle', async () => {
  await page.getByRole('button', { name: 'Menu do usuário' }).click();
  await page.getByRole('menuitemradio', { name: 'Escuro' }).click();
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await shot('05-dark');
});

await step('logout returns to login and blocks protected pages', async () => {
  await page.getByRole('button', { name: 'Menu do usuário' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await page.waitForURL('**/login');
  await page.goto(`${WEB}/configuracoes/usuarios`);
  await page.waitForURL(
    (u) => u.pathname === '/login' && u.searchParams.get('next') === '/configuracoes/usuarios',
    { timeout: 15_000 },
  );
});

await step('wrong password shows pt-BR message', async () => {
  await page.getByLabel('E-mail').fill(owner.email);
  await page.getByLabel('Senha').fill('errada999');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await toast('E-mail ou senha inválidos');
});

await step('waiter login hides admin menu', async () => {
  await page.getByLabel('E-mail').fill(waiter.email);
  await page.getByLabel('Senha').fill(waiter.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
  await page.getByText('Garçom', { exact: true }).first().waitFor({ timeout: 15_000 });
  if (await page.getByRole('link', { name: 'Usuários' }).count())
    throw new Error('Usuários visible');
  if (await page.getByRole('link', { name: 'Empresa' }).count()) throw new Error('Empresa visible');
  await shot('06-garcom');
});

await step('waiter landed on own home, not on the forbidden ?next page', async () => {
  if (new URL(page.url()).pathname !== '/cardapio') throw new Error(`landed on ${page.url()}`);
});

await step('forbidden page shows access denied', async () => {
  await page.goto(`${WEB}/configuracoes/usuarios`);
  await page.getByText('Acesso não permitido').waitFor({ timeout: 15_000 });
  await shot('06b-acesso-negado');
});

await step('login ignores external ?next (open redirect)', async () => {
  await page.getByRole('button', { name: 'Menu do usuário' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await page.waitForURL('**/login');
  await page.goto(`${WEB}/login?next=${encodeURIComponent('//example.com/phish')}`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill(waiter.email);
  await page.getByLabel('Senha').fill(waiter.password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/cardapio', { timeout: 15_000 });
  if (new URL(page.url()).origin !== WEB) throw new Error(`left origin: ${page.url()}`);
});

await step('forgot password sends e-mail (Mailpit)', async () => {
  await page.getByRole('button', { name: 'Menu do usuário' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await page.waitForURL('**/login');
  await page.waitForLoadState('networkidle');
  await page.getByRole('link', { name: 'Esqueci minha senha' }).click();
  await page.waitForURL('**/esqueci-senha');
  await page.getByLabel('E-mail').fill(owner.email);
  await page.getByRole('button', { name: 'Enviar link' }).click();
  await page.getByText('Verifique seu e-mail').waitFor();
  let found;
  for (let i = 0; i < 20 && !found; i++) {
    const res = await fetch(
      `http://localhost:8025/api/v1/search?query=to:${encodeURIComponent(owner.email)}`,
    );
    const data = await res.json();
    found = data.messages?.[0];
    if (!found) await new Promise((r) => setTimeout(r, 500));
  }
  if (!found) throw new Error('e-mail not received');
  const msg = await (await fetch(`http://localhost:8025/api/v1/message/${found.ID}`)).json();
  const link = /http:\/\/localhost:3000\/redefinir-senha\?token=[\w-]+/.exec(msg.Text)?.[0];
  if (!link) throw new Error('reset link not found');

  await page.goto(link);
  await page.getByLabel('Nova senha', { exact: true }).fill('NovaSenha123');
  await page.getByLabel('Confirme a nova senha').fill('NovaSenha123');
  await page.getByRole('button', { name: 'Redefinir senha' }).click();
  await page.waitForURL('**/login');
  await page.getByRole('heading', { name: 'Entrar' }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill(owner.email);
  await page.getByLabel('Senha').fill('NovaSenha123');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/painel', { timeout: 15_000 });
  await shot('07-painel');
});

await step('mobile layout: menu opens in a sheet', async () => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await page.getByRole('dialog').getByRole('link', { name: 'Usuários' }).waitFor();
  await shot('08-mobile');
});

console.log(results.join('\n'));
console.log(`\nconsole errors (${consoleErrors.length}):`);
for (const e of [...new Set(consoleErrors)].slice(0, 15)) console.log(`  - ${e.slice(0, 200)}`);
await browser.close();
