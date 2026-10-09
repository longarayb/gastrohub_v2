// Screenshots of the main panel screens in both themes, on the desktop and on the phone
// (feat/redesign). Against the production build (pnpm start:lite) and a fresh seed.
//
//   SHOTS=antes node screens.mjs        -> docs/screenshots/redesign/antes/{escuro,claro}/...
//   SHOTS=fase-a node screens.mjs       -> docs/screenshots/redesign/fase-a/...
//   SHOTS_DIR=../../docs/screenshots/final ONLY=painel,pedidos node screens.mjs
//
// docs/screenshots/redesign/ is gitignored; only the final set is versioned.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { BROWSER } from './browser.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(
  process.env.SHOTS_DIR ??
    path.join(HERE, '../../docs/screenshots/redesign', process.env.SHOTS ?? 'atual'),
);
const WEB = 'http://localhost:3000';
const PASSWORD = 'Demo1234';
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

/** [file name, path, user]; `mobile` also captures it at 390 px. */
const SCREENS = [
  { name: 'login', path: '/login', user: null, mobile: true },
  { name: 'painel', path: '/painel', user: 'dono', mobile: true },
  { name: 'pedidos', path: '/pedidos', user: 'dono', mobile: true },
  { name: 'pedidos-novo', path: '/pedidos/novo', user: 'dono', mobile: true },
  { name: 'caixa', path: '/caixa', user: 'caixa', mobile: true },
  { name: 'mesas', path: '/mesas', user: 'dono', mobile: true },
  { name: 'entregas', path: '/entregas', user: 'entregador', mobile: true, phoneOnly: true },
  { name: 'kds', path: '/kds', user: 'dono' },
  { name: 'entregadores', path: '/entregadores', user: 'dono' },
  { name: 'entregadores-relatorio', path: '/entregadores/relatorio', user: 'dono' },
  { name: 'areas-entrega', path: '/areas-entrega', user: 'dono' },
  { name: 'cupons', path: '/cupons', user: 'dono' },
  { name: 'relatorios-vendas', path: '/relatorios/vendas', user: 'dono' },
  { name: 'relatorios-perdas', path: '/relatorios/perdas', user: 'dono' },
  { name: 'relatorios-tempos', path: '/relatorios/tempos', user: 'dono' },
  { name: 'cardapio', path: '/cardapio', user: 'dono' },
  { name: 'cardapio-produto-novo', path: '/cardapio/produtos/novo', user: 'dono' },
  { name: 'cardapio-complementos', path: '/cardapio/complementos', user: 'dono' },
  { name: 'cardapio-setores', path: '/cardapio/setores', user: 'dono' },
  { name: 'config-empresa', path: '/configuracoes/empresa', user: 'dono' },
  { name: 'config-cardapio-digital', path: '/configuracoes/cardapio-digital', user: 'dono' },
  { name: 'config-impressao', path: '/configuracoes/impressao', user: 'dono' },
  { name: 'config-horarios', path: '/configuracoes/horarios', user: 'dono' },
  { name: 'config-usuarios', path: '/configuracoes/usuarios', user: 'dono' },
  { name: 'conta-senha', path: '/conta/senha', user: 'dono' },
  { name: 'referencia-visual', path: '/referencia-visual', user: 'dono', full: true },
].filter((s) => !ONLY || ONLY.has(s.name));

const THEMES = [
  ['escuro', 'dark'],
  ['claro', 'light'],
];
const DEVICES = [
  ['computador', { viewport: { width: 1440, height: 900 } }],
  ['celular', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
];

const browser = await chromium.launch({ ...BROWSER, args: ['--disable-gpu'] });
const problems = [];
let count = 0;

for (const [device, options] of DEVICES) {
  for (const [folder, theme] of THEMES) {
    const dir = path.join(OUT, folder, device);
    mkdirSync(dir, { recursive: true });
    // One context per user, so each signs in once per theme and device.
    const contexts = new Map();
    const pageFor = async (user) => {
      if (contexts.has(user)) return contexts.get(user);
      const context = await browser.newContext({
        ...options,
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
        reducedMotion: 'reduce',
      });
      await context.addInitScript((t) => {
        try {
          localStorage.setItem('theme', t);
        } catch {}
      }, theme);
      const page = await context.newPage();
      page.on('pageerror', (e) => problems.push(`${device}/${folder}: pageerror ${e.message}`));
      if (user) {
        await page.goto(`${WEB}/login`);
        await page.getByLabel('E-mail').fill(`${user}@demo.local`);
        await page.getByLabel('Senha').fill(PASSWORD);
        await page.getByRole('button', { name: 'Entrar' }).click();
        await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20_000 });
      }
      contexts.set(user, page);
      return page;
    };

    for (const screen of SCREENS) {
      if (device === 'celular' ? !screen.mobile : screen.phoneOnly) continue;
      const page = await pageFor(screen.user);
      try {
        await page.goto(`${WEB}${screen.path}`);
        await page.waitForLoadState('networkidle');
        // Skeletons and fonts settle; animations are already reduced.
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(600);
        await page.screenshot({
          path: path.join(dir, `${screen.name}.png`),
          fullPage: !!screen.full,
        });
        count += 1;
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        if (overflow > 0) {
          problems.push(`${device}/${folder}/${screen.name}: rolagem lateral de ${overflow}px`);
        }
      } catch (e) {
        problems.push(`${device}/${folder}/${screen.name}: ${e.message.split('\n')[0]}`);
      }
    }
    for (const page of contexts.values()) await page.context().close();
  }
}

await browser.close();
console.log(`${count} capturas em ${OUT}`);
for (const p of problems) console.log(`AVISO ${p}`);
