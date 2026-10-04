import { describe, expect, it } from 'vitest';
import { canAccess, homeFor, safeNext } from './routes';

describe('route access', () => {
  it('checks permissions by route prefix', () => {
    expect(canAccess('OWNER', '/configuracoes/usuarios')).toBe(true);
    expect(canAccess('WAITER', '/configuracoes/usuarios')).toBe(false);
    expect(canAccess('WAITER', '/conta/senha')).toBe(true);
    expect(canAccess('KITCHEN', '/cardapio')).toBe(true);
    expect(canAccess('KITCHEN', '/cardapio/produtos/abc')).toBe(false);
    expect(canAccess('MANAGER', '/cardapio/produtos/novo')).toBe(true);
  });

  it('sends each role to its home', () => {
    expect(homeFor('OWNER')).toBe('/painel');
    expect(homeFor('WAITER')).toBe('/cardapio');
    expect(homeFor('COURIER')).toBe('/conta/senha');
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
    expect(safeNext('/configuracoes/usuarios', 'WAITER')).toBe('/cardapio');
    expect(safeNext(null, 'COURIER')).toBe('/conta/senha');
  });
});
