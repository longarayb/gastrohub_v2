/**
 * WCAG AA contrast of the panel theme (docs/DESIGN.md, D039), in both themes: reads the
 * tokens from globals.css (and the brand colors from BRAND) and fails the build when a pair
 * drops below 4.5:1 (text) or 3:1 (field borders, focus, chart marks).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND } from '@app/shared';
import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(import.meta.dirname, 'globals.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`missing ${selector}`);
  const body = css.slice(start, css.indexOf('\n}', start));
  const vars: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
    vars[name!] = value!.trim();
  }
  return vars;
}

const light = {
  ...block(':root'),
  '--primary': BRAND.colors.light.primary,
  '--primary-foreground': BRAND.colors.light.primaryForeground,
  '--ring': BRAND.colors.light.primary,
};
const dark = {
  ...light,
  ...block('.dark'),
  '--primary': BRAND.colors.dark.primary,
  '--primary-foreground': BRAND.colors.dark.primaryForeground,
  '--ring': BRAND.colors.dark.primary,
};

function resolve(theme: Record<string, string>, name: string): string {
  let value = theme[name];
  for (let i = 0; value?.startsWith('var(') && i < 5; i++) {
    value = theme[value.slice(4, -1).trim()];
  }
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${name} is not a #rrggbb color: ${value}`);
  }
  return value;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** [foreground, background]: text, 4.5:1. */
const TEXT: [string, string][] = [
  ['--foreground', '--background'],
  ['--foreground', '--card'],
  ['--popover-foreground', '--popover'],
  ['--muted-foreground', '--card'],
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--muted'],
  ['--muted-foreground', '--track'],
  ['--muted-foreground', '--popover'],
  ['--foreground', '--muted'],
  ['--foreground', '--accent'],
  ['--secondary-foreground', '--secondary'],
  ['--primary', '--card'],
  ['--primary-foreground', '--primary'],
  ['--destructive', '--card'],
  ['--destructive-foreground', '--destructive'],
  ['--success-foreground', '--success'],
  ['--warning-foreground', '--warning'],
  ['--info-foreground', '--info'],
  ['--signal-critical', '--card'],
  ['--signal-attention', '--card'],
  ['--signal-positive', '--card'],
  ['--accent-blue', '--card'],
  ['--status-pending', '--card'],
  ['--status-accepted', '--card'],
  ['--status-preparing', '--card'],
  ['--status-ready', '--card'],
  ['--status-dispatched', '--card'],
  ['--status-delivered', '--card'],
  ['--status-canceled', '--card'],
  ['--sidebar-foreground', '--sidebar'],
  ['--sidebar-foreground', '--sidebar-to'],
  ['--muted-foreground', '--sidebar-to'],
  ['--nav-active-foreground', '--nav-active'],
  ['--avatar-foreground', '--avatar'],
];

/** Non-text elements (WCAG 1.4.11), 3:1. */
const UI: [string, string][] = [
  ['--input', '--card'],
  ['--input', '--background'],
  ['--ring', '--card'],
  ['--ring', '--background'],
  ['--chart-compare-cap', '--card'],
  ['--nav-active-bar', '--nav-active'],
];

describe.each([
  ['claro', light],
  ['escuro', dark],
])('theme %s', (_, theme) => {
  it.each(TEXT)('text %s on %s ≥ 4.5:1', (fg, bg) => {
    expect(ratio(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(4.5);
  });
  it.each(UI)('element %s on %s ≥ 3:1', (fg, bg) => {
    expect(ratio(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(3);
  });
});
