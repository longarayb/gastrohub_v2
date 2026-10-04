import { describe, expect, it } from 'vitest';
import { canAccess, homeFor, safeNext } from './routes';

describe('route access', () => {
  it('checks permissions by route prefix', () => {
    expect(canAccess('OWNER', '/configuracoes/usuarios')).toBe(true);
    expect(canAccess('WAITER', '/configuracoes/usuarios')).toBe(false);
    expect(canAccess('WAITER', '/conta/senha')).toBe(true);
  });

  it('sends each role to its home', () => {
    expect(homeFor('OWNER')).toBe('/painel');
    expect(homeFor('WAITER')).toBe('/conta/senha');
  });
});

describe('safeNext', () => {
  it('keeps allowed internal paths', () => {
    expect(safeNext('/configuracoes/usuarios', 'OWNER')).toBe('/configuracoes/usuarios');
    expect(safeNext('/configuracoes/empresa?tab=1', 'MANAGER')).toBe(
      '/configuracoes/empresa?tab=1',
    );
  });

  it('blocks open redirects', () => {
    expect(safeNext('//evil.com', 'OWNER')).toBe('/painel');
    expect(safeNext('/\\evil.com', 'OWNER')).toBe('/painel');
    expect(safeNext('https://evil.com', 'OWNER')).toBe('/painel');
    expect(safeNext('javascript:alert(1)', 'OWNER')).toBe('/painel');
  });

  it('ignores pages the role cannot open', () => {
    expect(safeNext('/configuracoes/usuarios', 'WAITER')).toBe('/conta/senha');
    expect(safeNext(null, 'WAITER')).toBe('/conta/senha');
  });
});
