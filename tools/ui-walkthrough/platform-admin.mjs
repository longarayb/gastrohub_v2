// Platform admin walkthrough (feat/platform-admin) against the production build and the seed:
// pnpm db:seed && pnpm start:lite --admin, then `npm run platform-admin`.
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BROWSER } from './browser.mjs';
import { ADMIN_URL, PLATFORM_ADMIN, freshCode, totp } from './platform-api.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const OUT = path.join(HERE, 'screenshots');
mkdirSync(OUT, { recursive: true });
const WEB = 'http://localhost:3000';
const MAILPIT = 'http://localhost:8025';
const stamp = Date.now();

const results = [];
let page;
const step = async (name, fn) => {
  try {
    await fn();
    results.push(`PASS  ${name}`);
  } catch (e) {
    results.push(`FAIL  ${name}: ${e.message.split('\n')[0]} @ ${page.url()}`);
    await page.screenshot({ path: path.join(OUT, `platform-fail-${results.length}.png`) });
  }
};

const browser = await chromium.launch({
  ...BROWSER,
  args: [
    '--disable-gpu',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--renderer-process-limit=1',
  ],
});
const admin = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
page = await admin.newPage();
const errors = [];
const watch = (p) => {
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('response', (r) => r.status() >= 500 && errors.push(`HTTP ${r.status()} ${r.url()}`));
};
watch(page);

const toast = (p, text) =>
  p.locator('[data-sonner-toast]', { hasText: text }).first().waitFor({ timeout: 15_000 });
const shot = (p, name) => p.screenshot({ path: path.join(OUT, `platform-${name}.png`) });

async function restaurantLogin(email, password = 'Demo1234') {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR' });
  const p = await ctx.newPage();
  watch(p);
  await p.goto(`${WEB}/login`);
  await p.waitForLoadState('networkidle');
  await p.getByLabel('E-mail').fill(email);
  await p.getByLabel('Senha').fill(password);
  await p.getByRole('button', { name: 'Entrar' }).click();
  await p.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
  return { ctx, p };
}

async function openCustomer(name) {
  await page.goto(`${ADMIN_URL}/clientes`);
  await page.getByRole('link', { name, exact: true }).click();
  await page.getByRole('heading', { name, exact: true }).waitFor();
}

await step('admin login asks for the second factor and refuses a wrong code', async () => {
  await page.goto(ADMIN_URL);
  await page.waitForURL('**/login');
  await page.getByLabel('E-mail').fill(PLATFORM_ADMIN.email);
  await page.getByLabel('Senha').fill(PLATFORM_ADMIN.password);
  await page.getByRole('button', { name: 'Continuar' }).click();
  const code = page.getByLabel('Código do aplicativo autenticador');
  await code.waitFor();
  await shot(page, '01-codigo');
  await code.fill('000000');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await toast(page, 'Código inválido');
  await code.fill(freshCode());
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: 'Visão geral' }).waitFor({ timeout: 20_000 });
});

await step('overview shows customers by situation and recurring revenue', async () => {
  const kpis = page.getByRole('region', { name: 'Indicadores' });
  for (const label of [
    'Receita mensal recorrente',
    'Ativos',
    'Em teste',
    'Atrasados',
    'Somente leitura',
    'Cancelados',
  ]) {
    await kpis.getByText(label, { exact: true }).waitFor();
  }
  await page.getByText('Bar do Porto').first().waitFor();
  await shot(page, '02-visao-geral');
});

await step('customers list with statuses and search', async () => {
  await page.getByRole('link', { name: 'Clientes' }).click();
  await page.waitForURL('**/clientes');
  await page.getByRole('heading', { name: 'Clientes', exact: true }).waitFor();
  for (const name of ['Pizzaria Bella Massa', 'Lanchonete do Zé', 'Bar do Porto', 'Café Central']) {
    await page.getByRole('link', { name, exact: true }).waitFor();
  }
  await page.getByText('Em teste').first().waitFor();
  await page.getByText('Somente leitura').first().waitFor();
  await shot(page, '03-clientes');
  await page.getByLabel('Buscar cliente').fill('porto');
  await page.getByRole('link', { name: 'Lanchonete do Zé' }).waitFor({ state: 'detached' });
  await page.getByLabel('Buscar cliente').fill('');
});

await step('restaurant banners: trial, overdue and read-only (sales blocked)', async () => {
  const trial = await restaurantLogin('dono.teste@exemplo.local');
  await trial.p.getByText('Período de teste').waitFor();
  await shot(trial.p, '04-painel-teste');
  await trial.ctx.close();

  const late = await restaurantLogin('dono.atrasado@exemplo.local');
  await late.p.getByText(/Mensalidade de R\$\s?149,00 em atraso/).waitFor();
  await shot(late.p, '05-painel-atraso');
  await late.ctx.close();

  const locked = await restaurantLogin('dono.suspenso@exemplo.local');
  await locked.p.getByText('Modo somente leitura').waitFor();
  await shot(locked.p, '06-painel-somente-leitura');
  await locked.ctx.close();
});

await step('registering the payment unblocks the store right away', async () => {
  await openCustomer('Bar do Porto');
  await page.getByText(/Atraso de \d+ dia/).waitFor();
  await page.getByRole('button', { name: 'Registrar pagamento' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Registrar pagamento' });
  await dialog.getByLabel('Observação (opcional)').fill('PIX conferido no extrato');
  await shot(page, '07-pagamento');
  await dialog.getByRole('button', { name: 'Registrar pagamento' }).click();
  await toast(page, 'Pagamento registrado');
  await page.getByText('Ativo', { exact: true }).first().waitFor();

  const store = await restaurantLogin('dono.suspenso@exemplo.local');
  await store.p.getByRole('heading').first().waitFor();
  if (await store.p.getByText('Modo somente leitura').count()) throw new Error('still read-only');
  await store.ctx.close();
});

const newOwner = `dono.novo.${stamp}@exemplo.local`;
await step('new customer: organization, store, owner and invitation', async () => {
  await page.goto(`${ADMIN_URL}/clientes/novo`);
  await page.getByLabel('Nome do cliente').fill('Sorveteria UI Teste');
  await page.getByLabel('CNPJ ou CPF').fill('45723174000110');
  await page.getByLabel('Razão social ou nome completo').fill('Sorveteria UI Teste LTDA');
  await page.getByLabel('E-mail para nota fiscal').fill('nota@sorveteria.test');
  await page.getByLabel('Contato', { exact: true }).fill('Lia Contato');
  await page.getByLabel('Telefone do contato').fill('11987651234');
  await page.getByLabel('CEP').fill('01310100');
  await page.getByLabel('CEP').blur();
  await page
    .waitForFunction(
      () => document.querySelector('input[name="customer.address.street"]')?.value.length > 0,
      null,
      { timeout: 15_000 },
    )
    .catch(async () => {
      await page.getByLabel('Rua').fill('Avenida Paulista');
      await page.getByLabel('Bairro').fill('Bela Vista');
      await page.getByLabel('Cidade').fill('São Paulo');
      await page.getByLabel('UF').fill('SP');
    });
  await page.getByLabel('Número').fill('2000');
  await page.getByLabel('Nome fantasia').fill('Sorveteria UI Teste');
  await page.getByLabel('CNPJ da unidade').fill('45723174000110');
  await page.getByLabel('Telefone da unidade').fill('11987651234');
  await page.getByLabel('Nome', { exact: true }).fill('Lia Dona');
  await page.getByLabel('E-mail (recebe o convite)').fill(newOwner);
  await page.getByLabel('Plano').click();
  await page.getByRole('option', { name: /^Completo/ }).click();
  await shot(page, '08-novo-cliente');
  await page.getByRole('button', { name: 'Cadastrar e enviar convite' }).click();
  await toast(page, 'Cliente cadastrado');
  await page.getByRole('heading', { name: 'Sorveteria UI Teste' }).waitFor();
  await page.getByText('Convite pendente').waitFor();
});

await step('the invited owner sets the password and accepts the terms', async () => {
  let link = null;
  for (let i = 0; i < 30 && !link; i++) {
    const search = await fetch(
      `${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(newOwner)}`,
    ).then((r) => r.json());
    const id = search.messages?.[0]?.ID;
    if (id) {
      const msg = await fetch(`${MAILPIT}/api/v1/message/${id}`).then((r) => r.json());
      link = /http:\/\/localhost:3000\/convite\?token=[\w-]+/.exec(msg.Text)?.[0] ?? null;
    }
    if (!link) await new Promise((r) => setTimeout(r, 500));
  }
  if (!link) throw new Error('invitation e-mail not found');
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 860 }, locale: 'pt-BR' });
  const p = await ctx.newPage();
  watch(p);
  await p.goto(link);
  await p.getByLabel('Crie sua senha').fill('SenhaNova123');
  await p.getByLabel('Confirme a senha').fill('SenhaNova123');
  await shot(p, '09-convite');
  await p.getByRole('button', { name: 'Definir senha e entrar' }).click();
  const dialog = p.getByRole('dialog', { name: 'Termos de uso e privacidade' });
  await dialog.waitFor({ timeout: 20_000 });
  await dialog
    .getByLabel('Li e aceito os termos de uso e a política de privacidade da plataforma.')
    .click();
  await dialog.getByRole('button', { name: 'Aceitar e continuar' }).click();
  await dialog.waitFor({ state: 'detached' });
  await ctx.close();
});

await step('manual suspension is scheduled for the end of the business day', async () => {
  await openCustomer('Lanchonete do Zé');
  await page.getByRole('button', { name: 'Suspender' }).click();
  const dialog = page.getByRole('dialog', { name: 'Suspender assinatura' });
  await dialog.getByLabel('Motivo (fica na auditoria)').fill('Teste do roteiro visual');
  await dialog.getByRole('button', { name: 'Suspender' }).click();
  await toast(page, 'Suspensão agendada');
  await page.getByText('Suspensa: Teste do roteiro visual').waitFor();
  await page.getByRole('button', { name: 'Reativar', exact: true }).click();
  const back = page.getByRole('dialog', { name: 'Reativar assinatura' });
  await back.getByLabel('Motivo (fica na auditoria)').fill('Fim do teste');
  await back.getByRole('button', { name: 'Reativar' }).click();
  await toast(page, 'Assinatura reativada');
  await page.getByText('Histórico da assinatura').click();
  await page.getByText('Reativada').first().waitFor();
});

await step('plans: create with extra store price and modules', async () => {
  await page.getByRole('link', { name: 'Planos' }).click();
  await page.getByRole('button', { name: 'Novo plano' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nome').fill(`Teste UI ${stamp}`);
  await dialog.getByLabel('Preço por período').fill('19900');
  await dialog.getByLabel('Permite unidades adicionais').click();
  await dialog.getByLabel('Valor por unidade adicional (por período)').fill('5900');
  await dialog.getByLabel('Cardápio digital').click();
  await shot(page, '10-plano');
  await dialog.getByRole('button', { name: 'Salvar' }).click();
  await toast(page, 'Plano criado');
  await page.getByText(`Teste UI ${stamp}`).waitFor();
});

await step('monthly fees: filters and generation', async () => {
  await page.getByRole('link', { name: 'Mensalidades' }).click();
  await page.getByRole('radio', { name: 'Atrasadas' }).waitFor();
  await page.getByRole('cell', { name: 'Lanchonete do Zé' }).waitFor();
  await page.getByRole('radio', { name: 'Pagas' }).click();
  await page.getByText('PIX conferido no extrato').waitFor();
  await page.getByRole('button', { name: 'Gerar mensalidades do período' }).click();
  await toast(page, /mensalidade/);
  await shot(page, '11-mensalidades');
});

await step('support session: banner in the store, then ended by the admin', async () => {
  // The demo restaurant, found by its menu address (the product name is never hardcoded).
  await page.goto(`${ADMIN_URL}/clientes`);
  await page.getByLabel('Buscar cliente').fill('demo');
  await page.getByRole('link', { name: 'Lanchonete do Zé' }).waitFor({ state: 'detached' });
  await page.getByRole('table').getByRole('link').first().click();
  await page.getByRole('button', { name: 'Acessar como suporte' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Acessar como suporte' });
  await dialog.getByLabel('Motivo').fill('Roteiro visual: conferir o relatório de vendas');
  const [tab] = await Promise.all([
    admin.waitForEvent('page'),
    dialog.getByRole('button', { name: 'Iniciar acesso' }).click(),
  ]);
  watch(tab);
  await tab.getByText('Suporte da plataforma conectado').waitFor({ timeout: 30_000 });
  await shot(tab, '12-suporte-no-painel');
  await page.getByRole('link', { name: 'Acessos de suporte' }).click();
  await page.getByRole('button', { name: 'Encerrar agora' }).first().click();
  await toast(page, 'Acesso encerrado');
  await tab.reload();
  await tab.getByText('Acesso de suporte encerrado').waitFor({ timeout: 20_000 });
  await tab.close();
});

await step('audit lists every action, with filter', async () => {
  await page.getByRole('link', { name: 'Auditoria' }).click();
  await page.getByText('Pagamento registrado').first().waitFor();
  await page.getByRole('radio', { name: 'Suporte' }).click();
  await page.getByText('Acesso de suporte encerrado').first().waitFor();
  await shot(page, '13-auditoria');
});

await step('settings: open signup requires a plan; back to invite only', async () => {
  await page.getByRole('link', { name: 'Configurações' }).click();
  await page.getByRole('radio', { name: 'Aberto, com período de teste' }).click();
  await page.getByLabel('Plano do período de teste').waitFor();
  await shot(page, '14-configuracoes');
  await page.getByRole('radio', { name: 'Só por convite' }).click();
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await toast(page, 'Configurações salvas');
});

await step('own account: new recovery codes with a current code', async () => {
  await page.getByRole('button', { name: 'Minha conta' }).click();
  await page.getByRole('menuitem', { name: 'Minha conta e 2FA' }).click();
  await page.getByLabel('Código atual do autenticador').fill(freshCode());
  await page.getByRole('button', { name: 'Gerar novos códigos' }).click();
  await page.getByText('Guarde estes códigos agora').waitFor();
});

await step(
  'admin created on the server: 2FA, then the temporary password is changed first',
  async () => {
    // The production command, run like on the server (from the API folder, which reads the .env).
    const email = `novo.admin.${stamp}@plataforma.local`;
    const out = execFileSync(
      process.execPath,
      ['dist/cli/platform-admin.js', 'create', '--email', email, '--name', 'Admin Novo'],
      { cwd: path.join(ROOT, 'apps', 'api'), encoding: 'utf8' },
    );
    const temporary = /Senha temporária \(mostrada só agora\): (\S+)/.exec(out)?.[1];
    if (!temporary) throw new Error(`no temporary password in: ${out}`);

    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: 'pt-BR',
    });
    const p = await ctx.newPage();
    watch(p);
    await p.goto(`${ADMIN_URL}/login`);
    await p.getByLabel('E-mail').fill(email);
    await p.getByLabel('Senha').fill(temporary);
    await p.getByRole('button', { name: 'Continuar' }).click();
    const secret = (await p.locator('code').first().textContent())?.trim();
    if (!secret) throw new Error('enrollment secret not shown');
    await p.getByLabel('Código que aparece no aplicativo').fill(totp(secret));
    await p.getByRole('button', { name: 'Ativar e entrar' }).click();
    await p.getByRole('checkbox', { name: /Guardei os códigos/ }).click();
    await p.getByRole('button', { name: 'Continuar' }).click();

    // Before any other screen: the password change, without the menu.
    await p.getByRole('heading', { name: 'Crie a sua senha' }).waitFor();
    if (await p.getByRole('link', { name: 'Clientes' }).count()) throw new Error('menu shown');
    await shot(p, '17-troca-obrigatoria');
    await p.getByLabel('Senha temporária', { exact: true }).fill(temporary);
    await p.getByLabel('Nova senha', { exact: true }).fill(temporary);
    await p.getByLabel('Confirme a nova senha').fill(temporary);
    await p.getByRole('button', { name: 'Salvar e continuar' }).click();
    await p.getByText('Escolha uma senha diferente da atual').waitFor();
    await p.getByLabel('Nova senha', { exact: true }).fill('MinhaSenhaNova1');
    await p.getByLabel('Confirme a nova senha').fill('MinhaSenhaNova1');
    await p.getByRole('button', { name: 'Salvar e continuar' }).click();
    await toast(p, 'Senha criada');
    await p.getByRole('heading', { name: 'Visão geral' }).waitFor({ timeout: 20_000 });
    await ctx.close();
  },
);

await step('phone layout and light theme', async () => {
  await page.goto(ADMIN_URL);
  await page.getByRole('heading', { name: 'Visão geral' }).waitFor();
  await page
    .getByRole('region', { name: 'Indicadores' })
    .getByText('Ativos', { exact: true })
    .waitFor();
  await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'));
  await page.waitForTimeout(500); // theme transition
  await shot(page, '15-claro');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Abrir menu' }).waitFor();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('horizontal scroll on the phone');
  await shot(page, '16-celular');
});

await browser.close();
console.log(results.join('\n'));
console.log(`\nerros (${errors.length}):`);
for (const e of [...new Set(errors)].slice(0, 15)) console.log(`  - ${e.slice(0, 200)}`);
