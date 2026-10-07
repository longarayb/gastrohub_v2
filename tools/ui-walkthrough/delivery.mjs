// Delivery walkthrough (feat/delivery): areas, quote in the composer, dispatch of several
// orders, "não entregue", courier phone app, settlement in the register, payout and report.
// Against the production build and a fresh demo seed (`pnpm db:seed`).
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

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
    await page.screenshot({ path: path.join(OUT, `delivery-fail-${results.length}.png`) });
    await closeAll().catch(() => {});
  }
};

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--disable-gpu', '--disable-extensions', '--renderer-process-limit=1'],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'pt-BR',
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
const shot = (name) => page.screenshot({ path: path.join(OUT, `delivery-${name}.png`) });
const dialog = (name) => page.getByRole('dialog', { name });
const column = (name) => page.getByRole('region', { name });
const sheet = () => page.getByRole('dialog').last();

/** Closes every open dialog (one at a time, waiting for the closing animation). */
async function closeAll() {
  for (let i = 0; i < 6; i++) {
    const open = await page.evaluate(() => document.querySelectorAll('[role=dialog]').length);
    if (!open) return;
    await page.keyboard.press('Escape');
    await page
      .waitForFunction((n) => document.querySelectorAll('[role=dialog]').length < n, open, {
        timeout: 5_000,
      })
      .catch(() => {});
  }
}

async function login(email) {
  await page.goto(`${WEB}/login`);
  await page.waitForLoadState('networkidle');
  await page.getByLabel('E-mail').fill(email);
  await page.getByLabel('Senha').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 15_000 });
}

async function logout() {
  await closeAll();
  await page.getByRole('button', { name: 'Menu do usuário' }).click();
  await page.getByRole('menuitem', { name: 'Sair' }).click();
  await page.waitForURL('**/login');
}

async function noHorizontalScroll() {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('page scrolls horizontally on mobile');
}

// ---------------------------------------------------------------------------
// Areas

await step('manager: areas by neighborhood and radius, one suspended', async () => {
  await login('gerente@demo.local');
  await page.getByRole('link', { name: 'Áreas de entrega' }).click();
  await page.waitForURL('**/areas-entrega');
  const pinheiros = page.getByRole('article', { name: 'Área Pinheiros' });
  await pinheiros.getByText('Suspensa').waitFor();
  await pinheiros.getByText('Chuva forte').waitFor();
  await page.getByRole('article', { name: 'Área Até 5 km' }).getByText('Raio de 5 km').waitFor();
  await page
    .getByRole('article', { name: 'Área Centro expandido' })
    .getByRole('listitem')
    .filter({ hasText: 'Bixiga' })
    .waitFor();
  await shot('01-areas');
});

await step('unmatched neighborhoods: include Vila Madalena in an area', async () => {
  const row = page
    .getByRole('list', { name: 'Bairros sem área' })
    .getByRole('listitem')
    .filter({ hasText: 'Vila Madalena' });
  await row.getByText('2×').waitFor();
  await row.getByRole('combobox', { name: 'Área para Vila Madalena' }).click();
  await page.getByRole('option', { name: 'Pinheiros' }).click();
  await row.getByRole('button', { name: 'Incluir' }).click();
  await toast('Vila Madalena incluído na área');
  await row.waitFor({ state: 'detached' });
  await page
    .getByRole('article', { name: 'Área Pinheiros' })
    .getByRole('listitem')
    .filter({ hasText: 'Vila Madalena' })
    .waitFor();
});

await step('new area by neighborhood with validation, then resume a suspended one', async () => {
  await page.getByRole('button', { name: 'Nova área' }).click();
  const d = dialog('Nova área de entrega');
  await d.getByLabel('Nome da área').fill('Liberdade');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await d.getByText('Informe pelo menos um bairro').waitFor();
  await d.getByLabel(/Bairros e variações/).fill('Liberdade\nBairro da Liberdade');
  await d.getByLabel('Taxa de entrega').fill('800');
  await d.getByLabel('Tempo de entrega (min)').fill('45');
  await shot('02-area-form');
  await d.getByRole('button', { name: 'Salvar' }).click();
  await toast('Área criada');
  await page.getByRole('article', { name: 'Área Liberdade' }).waitFor();
  // Liberdade is no longer an unmatched neighborhood; Moema (digital menu searches) still is.
  const unmatched = page.getByRole('list', { name: 'Bairros sem área' });
  await unmatched
    .getByRole('listitem')
    .filter({ hasText: 'Liberdade' })
    .waitFor({ state: 'detached' });
  await unmatched.getByRole('listitem').filter({ hasText: 'Moema' }).waitFor();
  await page
    .getByRole('article', { name: 'Área Pinheiros' })
    .getByRole('button', { name: 'Retomar' })
    .click();
  await toast('Entrega retomada para Pinheiros');
});

await step('cashier suspends an area for the rain with automatic resume', async () => {
  await logout();
  await login('caixa@demo.local');
  await page.goto(`${WEB}/areas-entrega`);
  const jardins = page.getByRole('article', { name: 'Área Jardins' });
  // The cashier operates (suspend/resume) but does not edit areas.
  await page.getByRole('button', { name: 'Nova área' }).waitFor({ state: 'detached' });
  await jardins.getByRole('button', { name: 'Suspender' }).click();
  const d = dialog('Suspender Jardins');
  await d.getByRole('button', { name: 'Chuva', exact: true }).click();
  await d.getByLabel(/Retomar automaticamente/).fill('23:59');
  await d.getByRole('button', { name: 'Suspender' }).click();
  await toast('Entrega suspensa para Jardins');
  await jardins.getByText(/Chuva · volta às 23:59/).waitFor();
});

// ---------------------------------------------------------------------------
// Composer and board

let createdNumber;
await step('composer: area fee from the address, lower fee needs a reason', async () => {
  await page.goto(`${WEB}/pedidos/novo`);
  await page.getByRole('tab', { name: 'Delivery' }).click();
  await page.getByText('Complete o endereço para calcular a taxa de entrega.').waitFor();
  await page.getByLabel('Telefone').fill('(11) 9912');
  await page
    .getByLabel('Clientes encontrados')
    .getByRole('button', { name: /Mariana/ })
    .click();
  await page.getByRole('radio', { name: /Avenida Paulista, 1500/ }).waitFor();
  const fee = page.getByRole('region', { name: 'Taxa de entrega' });
  await fee.getByText('Centro expandido').waitFor();
  await fee.getByText(/35 min/).waitFor();
  await page.getByRole('button', { name: /^X-Burguer/ }).click();
  const builder = page.getByRole('dialog');
  await builder.getByRole('button', { name: 'Ao ponto' }).click();
  await builder.getByRole('button', { name: /^Adicionar · R\$/ }).click();
  await builder.waitFor({ state: 'detached' });
  // Below the area minimum (R$ 30,00): a warning, the operator decides.
  await fee.getByText(/Abaixo do pedido mínimo da área/).waitFor();
  await fee.getByRole('button', { name: 'Alterar taxa' }).click();
  await fee.getByLabel('Nova taxa').fill('300');
  await page.getByRole('button', { name: 'Criar pedido' }).click();
  await fee.getByText('Informe o motivo para reduzir a taxa de entrega').waitFor();
  await fee.getByLabel('Motivo da redução').fill('Cliente frequente');
  await shot('03-composer-quote');
  await page.getByRole('button', { name: 'Criar pedido' }).click();
  await toast(/Pedido #\d+ criado/);
  const text = await page.locator('[data-sonner-toast]').first().innerText();
  createdNumber = Number(text.match(/#(\d+)/)[1]);
  await page.waitForURL('**/pedidos');
});

await step('order detail: area, reduced fee with reason and map links', async () => {
  await page.getByRole('button', { name: `Pedido ${createdNumber}`, exact: true }).click();
  const s = sheet();
  const delivery = s.getByRole('region', { name: 'Entrega' });
  await delivery.getByText(/Centro expandido/).waitFor();
  await delivery.getByText(/R\$ 3,00 \(sugerida R\$ 6,00\) · Cliente frequente/).waitFor();
  await delivery.getByRole('link', { name: 'Google Maps' }).waitFor();
  await delivery.getByRole('link', { name: 'Waze' }).waitFor();
  await shot('04-detail-delivery');
  await closeAll();
});

await step('board: failed delivery badge; dispatch two orders with one courier', async () => {
  const ready = column('Pronto');
  const carla = ready.locator('article').filter({ hasText: 'Carla' });
  await carla.getByText(/Não entregue · Cliente ausente/).waitFor();
  await carla.getByRole('button', { name: 'Reenviar' }).waitFor();
  await shot('05-board-failure');
  await ready.getByRole('button', { name: 'Saída' }).click();
  const d = dialog('Saída para entrega');
  await d
    .getByRole('checkbox', { name: /Pedido \d+/ })
    .first()
    .waitFor();
  const boxes = d.getByRole('checkbox', { name: /Pedido \d+/ });
  const count = await boxes.count();
  for (let i = 0; i < count; i++) await boxes.nth(i).check();
  await d.getByRole('radio', { name: /Helena Bike/ }).click();
  await shot('06-dispatch-dialog');
  await d.getByRole('button', { name: /Saiu para entrega/ }).click();
  await toast(/pedidos saíram com Helena Bike|Pedido saiu com Helena Bike/);
  await column('Saiu para entrega').locator('article').filter({ hasText: 'Carla' }).waitFor();
});

await step('not delivered from the detail: back to the store with the reason', async () => {
  const card = column('Saiu para entrega').locator('article').filter({ hasText: 'Carla' });
  await card.getByRole('button', { name: /^Pedido \d+$/ }).click();
  const s = sheet();
  await s.getByText(/2ª saída · Helena Bike/).waitFor();
  await s.getByRole('button', { name: 'Não entregue' }).click();
  const d = dialog(/não entregue$/);
  await d.getByRole('button', { name: 'Confirmar: não entregue' }).click();
  await d.getByText('Escolha o motivo').waitFor();
  await d.getByRole('radio', { name: 'Endereço não encontrado' }).click();
  await d.getByRole('button', { name: 'Confirmar: não entregue' }).click();
  await toast('Pedido voltou para a loja');
  await s
    .getByText(/Não entregue · Endereço não encontrado/)
    .first()
    .waitFor();
  await closeAll();
  await column('Pronto').locator('article').filter({ hasText: 'Carla' }).waitFor();
});

// ---------------------------------------------------------------------------
// Courier phone app

await step('courier phone: only the own route, map links, delivered with PIX', async () => {
  await logout();
  await page.setViewportSize({ width: 390, height: 844 });
  await login('entregador@demo.local');
  await page.waitForURL('**/entregas');
  const stop = page.getByRole('article', { name: /Entrega do pedido \d+/ }).first();
  await stop.getByText('Juliana Alves').waitFor();
  await stop.getByText(/Rua Augusta, 800/).waitFor();
  await stop.getByRole('link', { name: 'Google Maps' }).waitFor();
  await stop.getByRole('link', { name: 'Waze' }).waitFor();
  await stop.getByRole('link', { name: /Ligar/ }).waitFor();
  await page.getByRole('button', { name: 'Voltei para a loja' }).isDisabled();
  await shot('07-courier-route');
  await noHorizontalScroll();
  await stop.getByRole('button', { name: 'Entregue', exact: true }).click();
  const d = page.getByRole('dialog');
  // PIX comes preselected (what the customer chose when ordering).
  await d.getByRole('radio', { name: 'PIX', checked: true }).waitFor();
  await shot('08-courier-collection');
  await d.getByRole('button', { name: 'Confirmar entrega' }).click();
  await toast(/Pedido #\d+ entregue/);
  await stop.getByText(/Recebido: PIX/).waitFor();
});

await step('courier: the board is off limits; return to the store', async () => {
  await page.goto(`${WEB}/pedidos`);
  await page.getByText('Acesso não permitido').waitFor();
  await page.goto(`${WEB}/entregas`);
  await page.getByRole('button', { name: 'Voltei para a loja' }).click();
  await toast('Volta registrada. Faça o acerto no caixa.');
  await page.getByText('Nenhuma entrega em andamento').waitFor();
  await shot('09-courier-empty');
  await logout();
  await page.setViewportSize({ width: 1440, height: 900 });
});

// ---------------------------------------------------------------------------
// Settlement in the register

await step('cashier: couriers to settle in the register', async () => {
  await login('caixa@demo.local');
  await page.goto(`${WEB}/caixa`);
  const card = page.getByText('Acerto de entregadores').locator('..').locator('..');
  await card.getByRole('listitem').filter({ hasText: 'Gustavo Motoboy' }).waitFor();
  await card.getByRole('listitem').filter({ hasText: 'Helena Bike' }).waitFor();
  await shot('10-register-couriers');
});

await step('settle Helena: cash short, deducted, pay now (withdrawal)', async () => {
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Helena Bike' })
    .getByRole('button', { name: 'Acertar' })
    .click();
  const d = dialog('Acerto · Helena Bike');
  // Her new route is still out (one order pending): it waits for the next settlement.
  await d.getByText(/ainda em rota/).waitFor();
  await d.getByText(/Não entregue · Cliente ausente/).waitFor();
  const expected = await d.getByText(/^Dinheiro \(esperado R\$/).innerText();
  const cents = Number(expected.replace(/\D/g, ''));
  await d.getByLabel(/^Dinheiro \(esperado/).fill(String(cents - 200));
  await d.getByText('−R$ 2,00').first().waitFor();
  await d.getByLabel('Descontar a falta da remuneração do entregador').check();
  await d.getByText('Falta descontada').waitFor();
  await shot('11-settlement');
  await d.getByRole('button', { name: 'Concluir acerto' }).click();
  await toast(/Acerto de Helena Bike concluído/);
});

await step('settle Gustavo: PIX confirmed, no daily again, accumulate', async () => {
  await page
    .getByRole('listitem')
    .filter({ hasText: 'Gustavo Motoboy' })
    .getByRole('button', { name: 'Acertar' })
    .click();
  const d = dialog('Acerto · Gustavo Motoboy');
  await d.getByText('Diária (já paga hoje)').waitFor();
  await d.getByText('PIX e outros (sem contagem)').waitFor();
  await d.getByRole('radio', { name: 'Acumular' }).click();
  await d.getByRole('button', { name: 'Concluir acerto' }).click();
  await toast(/Acerto de Gustavo Motoboy concluído/);
  await page.getByText('Acerto de entregadores').waitFor({ state: 'detached' });
  // The withdrawals of the settlement are in the register movements.
  await page.getByText(/Falta no acerto do entregador Helena Bike/).waitFor();
  await page.getByText(/Pagamento ao entregador Helena Bike · Acerto/).waitFor();
});

// ---------------------------------------------------------------------------
// Couriers page, payout, report

await step('couriers page: balance, ledger and a weekly payout', async () => {
  await page.getByRole('link', { name: 'Entregadores' }).click();
  await page.waitForURL('**/entregadores');
  const gustavo = page.getByRole('article', { name: 'Entregador Gustavo Motoboy' });
  await gustavo.getByText(/A pagar R\$ 38,00/).waitFor();
  await gustavo.getByText(/app: Fábio Entregador/).waitFor();
  await shot('12-couriers');
  await gustavo.getByRole('button', { name: 'Extrato' }).click();
  const s = sheet();
  await s.getByText('Remuneração').first().waitFor();
  await s.getByRole('button', { name: 'Pagar entregador' }).click();
  const d = dialog('Pagar Gustavo Motoboy');
  await d.getByLabel('Valor').fill('2000');
  await d.getByLabel(/Observação/).fill('Semanal');
  await d.getByRole('button', { name: /Pagar R\$ 20,00/ }).click();
  await toast(/Pagamento de R\$ 20,00 registrado/);
  await s
    .getByText(/Pagamento/)
    .first()
    .waitFor();
  await s
    .getByText(/saldo R\$ 18,00/)
    .first()
    .waitFor();
  await shot('13-ledger');
  await closeAll();
});

await step('manager: edit a courier pay rule and see the report', async () => {
  await logout();
  await login('gerente@demo.local');
  await page.goto(`${WEB}/entregadores`);
  await page.getByRole('button', { name: 'Editar Helena Bike' }).click();
  const d = dialog('Editar Helena Bike');
  await d.getByText('Remuneração própria (senão, usa a padrão da loja)').waitFor();
  await d.getByLabel('Por entrega').waitFor();
  await closeAll();
  await page.getByRole('link', { name: 'Relatório de entregas' }).click();
  await page.waitForURL('**/entregadores/relatorio');
  await page.getByText('Taxas de entrega').waitFor();
  await page.getByRole('cell', { name: 'Centro expandido' }).waitFor();
  await page.getByRole('cell', { name: 'Helena Bike' }).waitFor();
  await page.getByText('Quem deve a quem').waitFor();
  await shot('14-report');
});

await step('dark theme and mobile couriers page', async () => {
  await page.goto(`${WEB}/entregadores`);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.getByRole('article', { name: 'Entregador Gustavo Motoboy' }).waitFor();
  await shot('15-couriers-dark');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('article', { name: 'Entregador Gustavo Motoboy' }).waitFor();
  await shot('16-couriers-mobile');
  await noHorizontalScroll();
  await page.goto(`${WEB}/areas-entrega`);
  await page.getByRole('article', { name: 'Área Jardins' }).waitFor();
  await noHorizontalScroll();
});

await browser.close();
console.log(results.join('\n'));
// Expected: 400 from the validations exercised above; 401 from the session check on the login
// page (no refresh cookie yet); 403 when the courier opens the board.
const unexpected = errors.filter(
  (e) => !/HTTP 40(0|3) /.test(e) && !/auth\/refresh|status of 40[13]/.test(e),
);
console.log(`\nErros HTTP/console: ${errors.length} (inesperados: ${unexpected.length})`);
for (const e of unexpected.slice(0, 20)) console.log('  ' + e);
process.exit(results.some((r) => r.startsWith('FAIL')) || unexpected.length ? 1 : 0);
