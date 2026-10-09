// Menu screens walkthrough against the production build, using the demo seed.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BROWSER } from './browser.mjs';
import { createRequire } from 'node:module';
const sharpPkg = createRequire(new URL('../../apps/api/package.json', import.meta.url))('sharp');

// Screenshots go to ./screenshots (gitignored).
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
    results.push(`FAIL  ${name}: ${e.message.split('\n')[0]} @ ${page.url()}`);
    await page.screenshot({ path: path.join(OUT, `menu-fail-${results.length}.png`) });
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
page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on(
  'response',
  (r) => r.status() >= 400 && errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`),
);

const toast = (text) => page.getByText(text).first().waitFor({ timeout: 10_000 });
const shot = (name) => page.screenshot({ path: path.join(OUT, `menu-${name}.png`) });

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
const productRow = (name) =>
  page.locator('div.border-b', { has: page.getByRole('link', { name, exact: true }) });

await step('owner sees the seeded menu', async () => {
  await login('dono@demo.local');
  await page.getByRole('link', { name: 'Produtos' }).click();
  await page.waitForURL('**/cardapio');
  for (const name of [
    'Bebidas',
    'Lanches',
    'Combos',
    'Porções',
    'Pizzas',
    'Sobremesas',
    'Almoço executivo',
  ]) {
    await page.locator('aside').getByText(name, { exact: true }).first().waitFor();
  }
  await page.getByRole('link', { name: 'X-Bacon', exact: true }).waitFor();
  await shot('01-lista');
});

await step('search is accent-insensitive and filters by status', async () => {
  await page.getByLabel('Buscar produtos').fill('agua');
  await page.getByRole('link', { name: 'Água mineral 500 ml' }).waitFor();
  await page
    .getByRole('link', { name: 'X-Bacon', exact: true })
    .waitFor({ state: 'detached', timeout: 10_000 });
  await page.getByLabel('Buscar produtos').fill('');
  await page.getByLabel('Status').click();
  await page.getByRole('option', { name: 'Pausados' }).click();
  await page.getByRole('link', { name: 'Onion rings' }).waitFor();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('a[href^="/cardapio/produtos/"]')].filter(
        (a) => !a.href.endsWith('/novo') && !a.href.includes('novo?'),
      ).length === 1,
  );
  await page.getByLabel('Status').click();
  await page.getByRole('option', { name: 'Todos' }).click();
});

await step('category names are not truncated and categories pause from the menu', async () => {
  const truncated = await page
    .locator('aside button.min-w-0 span.block')
    .evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent),
    );
  if (truncated.length) throw new Error('truncated: ' + truncated.join(', '));
  await page.getByRole('button', { name: 'Ações de Sobremesas' }).click();
  await page.getByRole('menuitem', { name: 'Acabou (até o fim do dia)' }).click();
  await toast('Categoria pausada até o fim do dia');
  await page
    .locator('aside')
    .getByText(/Pausado até/)
    .waitFor();
  await page.getByRole('button', { name: 'Ações de Sobremesas' }).click();
  await page.getByRole('menuitem', { name: 'Reativar categoria' }).click();
  await toast('Categoria disponível novamente');
});

await step('"Acabou" pauses until the end of the business day and can be resumed', async () => {
  const row = productRow('X-Burguer');
  await row.getByRole('button', { name: 'Acabou' }).click();
  await toast('Pausado até o fim do dia');
  await row.getByText(/Pausado até/).waitFor();
  await row.getByRole('button', { name: 'Reativar' }).click();
  await toast('Disponível novamente');
});

await step('categories reorder by keyboard drag and persist', async () => {
  const names = async () => page.locator('aside button.min-w-0 span.block').allTextContents();
  const before = await names();
  const handle = page.getByRole('button', { name: `Arrastar ${before[0]}` });
  await handle.focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
  await page.reload();
  await page.locator('aside').getByText('Lanches').first().waitFor();
  const after = await names();
  if (after[0] !== before[1] || after[1] !== before[0]) throw new Error(`order ${after.join(',')}`);
  // Put it back
  await page.getByRole('button', { name: `Arrastar ${after[0]}` }).focus();
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await page.keyboard.press('Space');
  await page.waitForTimeout(800);
});

await step('product editor: price change, inherited group turned off, live preview', async () => {
  await page.getByRole('link', { name: 'X-Bacon', exact: true }).click();
  await page.waitForURL('**/cardapio/produtos/**');
  await page.getByRole('heading', { name: 'X-Bacon', level: 1 }).waitFor();
  const preview = page.locator('aside').last();
  await preview.getByText('Molhos').first().waitFor();
  await page.getByText('Herdados da categoria', { exact: true }).waitFor();
  const molhos = page.locator('div.border-dashed', { hasText: 'Molhos' });
  await molhos.getByRole('button', { name: 'Desligar' }).click();
  await page.waitForFunction(
    () => !document.querySelector('aside:last-of-type')?.textContent?.includes('Barbecue'),
  );
  const price = page.getByLabel('Preço', { exact: true });
  await price.fill('');
  await price.pressSequentially('3890');
  await preview.getByText('R$ 32,90').first().waitFor(); // promo still applies
  await page.getByRole('button', { name: 'Salvar' }).click();
  await toast('Produto salvo');
  await page.reload();
  await page
    .locator('div.border-dashed', { hasText: 'Molhos' })
    .getByText('Desligado neste produto')
    .waitFor();
  await shot('02-editor');
});

await step('pizza flavor shows prices per size and crust in preview', async () => {
  await page.goto(`${WEB}/cardapio`);
  await page.locator('aside').getByText('Pizzas', { exact: true }).click();
  await page.getByRole('link', { name: 'Camarão', exact: true }).click();
  await page.getByRole('heading', { name: 'Camarão', level: 1 }).waitFor();
  for (const size of ['Broto', 'Média', 'Grande', 'Família']) {
    await page.getByLabel(`Preço ${size}`).waitFor();
  }
  const preview = page.locator('aside').last();
  await preview.getByText('Borda').first().waitFor();
  await preview.getByText('até 4 sabores').waitFor();
  await shot('03-pizza');
});

await step('create a sized product, upload a photo and duplicate it', async () => {
  await page.goto(`${WEB}/cardapio`);
  await page.locator('aside').getByText('Bebidas', { exact: true }).click();
  await page.getByRole('link', { name: 'Produto', exact: true }).click();
  await page.waitForURL('**/cardapio/produtos/novo**');
  await page.getByLabel('Nome', { exact: true }).fill('Chá gelado');
  await page.getByRole('button', { name: 'Por tamanho' }).click();
  const rows = page.locator('input[placeholder="Ex.: Lata 350 ml"]');
  await rows.nth(0).fill('300 ml');
  await page.getByLabel('Preço 300 ml').pressSequentially('800');
  await page.getByRole('button', { name: 'Tamanho', exact: true }).click();
  await rows.nth(1).fill('500 ml');
  await page.getByLabel('Preço 500 ml').pressSequentially('1100');
  await page.getByRole('button', { name: 'Salvar' }).click();
  await toast('Produto criado');
  await page.waitForURL((u) => /\/cardapio\/produtos\/(?!novo)/.test(u.pathname), {
    timeout: 15_000,
  });

  const png = await sharpPkg({
    create: { width: 1200, height: 900, channels: 3, background: '#0ea5e9' },
  })
    .png()
    .toBuffer();
  const file = path.join(OUT, 'cha.png');
  writeFileSync(file, png);
  await page.locator('input[type="file"]').setInputFiles(file);
  await toast('Foto atualizada');
  await page.locator('img[src$="-thumb.webp"]').first().waitFor();

  await page.getByRole('button', { name: 'Duplicar' }).click();
  await toast('Cópia criada');
  await page.getByRole('heading', { name: 'Chá gelado (cópia)', level: 1 }).waitFor();
  await page.getByText('Pausado', { exact: true }).first().waitFor();
  await shot('04-duplicado');
});

await step('preview dialog from the list', async () => {
  await page.goto(`${WEB}/cardapio`);
  await productRow('Combo X-Burguer')
    .getByRole('button', { name: 'Ações de Combo X-Burguer' })
    .click();
  await page.getByRole('menuitem', { name: 'Pré-visualizar' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Escolha a bebida').waitFor();
  await dialog.getByText('Guaraná lata').waitFor();
  await dialog.getByText('Obrigatório').first().waitFor();
  await shot('05-preview');
  await page.keyboard.press('Escape');
});

await step('complement groups: price by size and per-option pause', async () => {
  await page.getByRole('link', { name: 'Complementos' }).click();
  await page.waitForURL('**/cardapio/complementos');
  const borda = page.locator('[data-slot="card"]', { hasText: 'Borda' });
  const cheddar = borda.locator('li', { hasText: 'Cheddar' });
  await cheddar.getByRole('button', { name: 'Acabou' }).click();
  await toast('Pausado até o fim do dia');
  await cheddar.getByText(/Pausado até/).waitFor();
  await borda.getByRole('button', { name: 'Editar Borda' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Preço por tamanho/ })
    .first()
    .click();
  await page.getByRole('dialog').getByText('Pizzas — Família').waitFor();
  await shot('06-complementos');
  await page.keyboard.press('Escape');
});

await step('sectors: create and list', async () => {
  await page.getByRole('link', { name: 'Setores de produção' }).click();
  await page.getByLabel('Nome do novo setor').fill('Confeitaria');
  await page.getByRole('button', { name: 'Adicionar' }).click();
  await toast('Setor criado');
  await page.getByText('Setor padrão').waitFor();
});

await step('new pizza category starts with default sizes', async () => {
  await page.goto(`${WEB}/cardapio`);
  await page.getByRole('button', { name: 'Categoria', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill('Pizzas doces');
  await dialog.getByRole('button', { name: /^Pizza/ }).click();
  if ((await dialog.getByLabel('Nome do tamanho').count()) !== 3) throw new Error('default sizes');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await toast('Categoria criada');
  await page.locator('aside').getByText('Pizzas doces').waitFor();
});

await step('pizza pricing rule in store settings', async () => {
  await page.goto(`${WEB}/configuracoes/empresa`);
  await page.getByLabel('Preço da pizza com mais de um sabor').click();
  await page.getByRole('option', { name: 'Média dos sabores' }).click();
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await toast('Configurações salvas');
});

await step('cashier can pause but not edit', async () => {
  await logout();
  await login('caixa@demo.local');
  // The cashier lands on the orders board (feat/orders); the menu is one click away.
  await page.waitForURL('**/pedidos');
  await page.goto(`${WEB}/cardapio`);
  await productRow('X-Salada').getByRole('button', { name: 'Acabou' }).waitFor();
  if (await page.getByRole('link', { name: 'Produto', exact: true }).count())
    throw new Error('add product visible');
  await page.goto(`${WEB}/cardapio/produtos/novo`);
  await page.getByText('Acesso não permitido').waitFor();
});

await step('mobile layout of the menu screen', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${WEB}/cardapio`);
  await page.getByRole('link', { name: 'X-Salada', exact: true }).waitFor();
  await shot('07-mobile');
});

console.log(results.join('\n'));
const unexpected = errors.filter((e) => !/HTTP 401 POST .*auth\/refresh/.test(e));
console.log(`\nerrors (${unexpected.length}):`);
for (const e of [...new Set(unexpected)].slice(0, 15)) console.log(`  - ${e.slice(0, 220)}`);
await browser.close();
