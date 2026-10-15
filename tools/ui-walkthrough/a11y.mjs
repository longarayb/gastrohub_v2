// Automatic accessibility check (axe-core, WCAG 2.1 A and AA) of the main screens in both
// themes, on the desktop and on the phone (feat/redesign, phase D). Against the production
// build (pnpm start:lite --menu --admin) and a fresh seed.
//
//   node a11y.mjs                 every screen
//   ONLY=login,caixa node a11y.mjs
//
// Fails on "serious" and "critical" violations; "moderate" and "minor" are listed as warnings.
import AxeBuilder from '@axe-core/playwright';
import { chromium } from 'playwright-core';
import { BROWSER } from './browser.mjs';

const WEB = 'http://localhost:3000';
const MENU = 'http://localhost:3001';
const ADMIN = 'http://localhost:3002';
const PASSWORD = 'Demo1234';
const PLATFORM = 'platform';
// Seed recovery codes (each one works once; a fresh seed restores them).
let recoveryCode = 0;
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const BLOCKING = new Set(['serious', 'critical']);

/** `prepare` runs after the page loads (open a dialog, dismiss an overlay). */
const SCREENS = [
  { name: 'login', url: `${WEB}/login`, user: null, mobile: true },
  { name: 'cadastro', url: `${WEB}/cadastro`, user: null, mobile: true },
  { name: 'esqueci-senha', url: `${WEB}/esqueci-senha`, user: null },
  { name: 'painel', url: `${WEB}/painel`, user: 'dono', mobile: true },
  { name: 'pedidos', url: `${WEB}/pedidos`, user: 'dono', mobile: true },
  { name: 'pedidos-novo', url: `${WEB}/pedidos/novo`, user: 'caixa', mobile: true },
  {
    name: 'pedidos-novo-item',
    url: `${WEB}/pedidos/novo`,
    user: 'caixa',
    prepare: async (page) => {
      await page.getByLabel('Buscar produto').fill('x-burguer');
      // The catalog may still be loading: wait for the product, then open it.
      await page
        .getByRole('button', { name: /^X-Burguer/ })
        .first()
        .click();
      await page.getByRole('dialog').waitFor();
    },
  },
  { name: 'caixa', url: `${WEB}/caixa`, user: 'caixa', mobile: true },
  { name: 'mesas', url: `${WEB}/mesas`, user: 'dono', mobile: true },
  {
    name: 'despacho',
    url: `${WEB}/despacho`,
    user: 'caixa',
    mobile: true,
    prepare: async (page) => {
      await page.getByRole('heading', { name: /Prontos/ }).waitFor();
    },
  },
  { name: 'entregas', url: `${WEB}/entregas`, user: 'entregador', mobile: true, phoneOnly: true },
  {
    name: 'kds',
    url: `${WEB}/kds`,
    user: 'dono',
    prepare: async (page) => {
      await page.getByText('Toque para iniciar').click();
      await page.getByRole('region', { name: 'Na fila' }).waitFor();
    },
  },
  { name: 'relatorios-vendas', url: `${WEB}/relatorios/vendas`, user: 'dono' },
  { name: 'cardapio', url: `${WEB}/cardapio`, user: 'dono' },
  { name: 'cardapio-produto-novo', url: `${WEB}/cardapio/produtos/novo`, user: 'dono' },
  { name: 'config-empresa', url: `${WEB}/configuracoes/empresa`, user: 'dono' },
  { name: 'config-usuarios', url: `${WEB}/configuracoes/usuarios`, user: 'dono' },
  { name: 'cardapio-digital', url: `${MENU}/demo`, user: null, mobile: true, phoneOnly: true },
  // Platform notices in the restaurant panel (feat/platform-admin): trial, overdue, read-only.
  { name: 'painel-teste', url: `${WEB}/painel`, user: 'dono.teste@exemplo.local' },
  {
    name: 'painel-atraso',
    url: `${WEB}/painel`,
    user: 'dono.atrasado@exemplo.local',
    mobile: true,
  },
  { name: 'painel-somente-leitura', url: `${WEB}/painel`, user: 'dono.suspenso@exemplo.local' },
  // Platform admin app (seed admin; each context signs in with one recovery code).
  { name: 'admin-login', url: `${ADMIN}/login`, user: null, mobile: true },
  { name: 'admin-visao-geral', url: `${ADMIN}/`, user: PLATFORM, mobile: true },
  { name: 'admin-clientes', url: `${ADMIN}/clientes`, user: PLATFORM, mobile: true },
  {
    name: 'admin-cliente',
    url: `${ADMIN}/clientes`,
    user: PLATFORM,
    prepare: async (page) => {
      await page.getByRole('link', { name: 'Lanchonete do Zé', exact: true }).click();
      await page.getByRole('heading', { name: 'Lanchonete do Zé', exact: true }).waitFor();
      await page.waitForLoadState('networkidle');
    },
  },
  { name: 'admin-clientes-novo', url: `${ADMIN}/clientes/novo`, user: PLATFORM },
  { name: 'admin-planos', url: `${ADMIN}/planos`, user: PLATFORM },
  { name: 'admin-cobrancas', url: `${ADMIN}/cobrancas`, user: PLATFORM, mobile: true },
  { name: 'admin-suporte', url: `${ADMIN}/suporte`, user: PLATFORM },
  { name: 'admin-auditoria', url: `${ADMIN}/auditoria`, user: PLATFORM },
  { name: 'admin-configuracoes', url: `${ADMIN}/configuracoes`, user: PLATFORM },
  { name: 'admin-conta', url: `${ADMIN}/conta`, user: PLATFORM },
].filter((s) => !ONLY || ONLY.has(s.name));

const THEMES = ['dark', 'light'];
const DEVICES = [
  ['computador', { viewport: { width: 1440, height: 900 } }],
  ['celular', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
];

const browser = await chromium.launch({ ...BROWSER, args: ['--disable-gpu'] });
const failures = [];
const warnings = [];
let checked = 0;

const describe = (where, v) =>
  `${where}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}×)\n` +
  v.nodes
    .slice(0, 3)
    .map(
      (n) =>
        `      ${n.target.join(' ')}${n.failureSummary ? ` · ${n.failureSummary.split('\n').slice(1).join(' ').trim()}` : ''}`,
    )
    .join('\n');

for (const [device, options] of DEVICES) {
  for (const theme of THEMES) {
    const contexts = new Map();
    const pageFor = async (user) => {
      if (contexts.has(user)) return contexts.get(user);
      const context = await browser.newContext({
        ...options,
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        reducedMotion: 'reduce',
        colorScheme: theme,
      });
      await context.addInitScript((t) => {
        try {
          localStorage.setItem('theme', t);
        } catch {}
      }, theme);
      const page = await context.newPage();
      if (user === PLATFORM) {
        await page.goto(`${ADMIN}/login`);
        await page.getByLabel('E-mail').fill('admin@plataforma.local');
        await page.getByLabel('Senha').fill('Plataforma123');
        await page.getByRole('button', { name: 'Continuar' }).click();
        await page.getByRole('button', { name: 'Usar um código de recuperação' }).click();
        recoveryCode += 1;
        await page
          .getByLabel('Código de recuperação')
          .fill(`RECUP-${String(recoveryCode).padStart(5, '0')}`);
        await page.getByRole('button', { name: 'Entrar' }).click();
        await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
      } else if (user) {
        await page.goto(`${WEB}/login`);
        await page.getByLabel('E-mail').fill(user.includes('@') ? user : `${user}@demo.local`);
        await page.getByLabel('Senha').fill(PASSWORD);
        await page.getByRole('button', { name: 'Entrar' }).click();
        await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
      }
      contexts.set(user, page);
      return page;
    };

    for (const screen of SCREENS) {
      if (device === 'celular' ? !screen.mobile : screen.phoneOnly) continue;
      const where = `${screen.name} (${device}, ${theme === 'dark' ? 'escuro' : 'claro'})`;
      const page = await pageFor(screen.user);
      try {
        await page.goto(screen.url);
        await page.waitForLoadState('networkidle');
        await page.evaluate(() => document.fonts.ready);
        if (screen.prepare) await screen.prepare(page);
        await page.waitForTimeout(500);
        const { violations } = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();
        checked += 1;
        for (const v of violations) {
          (BLOCKING.has(v.impact) ? failures : warnings).push(describe(where, v));
        }
      } catch (e) {
        failures.push(`${where}: ${e.message.split('\n')[0]}`);
      }
    }
    for (const page of contexts.values()) await page.context().close();
  }
}

await browser.close();
console.log(`${checked} telas verificadas (WCAG 2.1 A e AA)`);
for (const f of failures) console.log(`FAIL  ${f}`);
for (const w of warnings) console.log(`AVISO ${w}`);
if (!failures.length) console.log('PASS  nenhuma violação séria ou crítica');
process.exit(failures.length ? 1 : 0);
