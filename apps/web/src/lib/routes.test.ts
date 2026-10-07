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
    expect(canAccess('KITCHEN', '/pedidos')).toBe(true);
    expect(canAccess('KITCHEN', '/pedidos/novo')).toBe(false);
    expect(canAccess('WAITER', '/pedidos/novo')).toBe(true);
    expect(canAccess('WAITER', '/mesas')).toBe(true);
    expect(canAccess('CASHIER', '/cupons')).toBe(false);
    expect(canAccess('CASHIER', '/caixa')).toBe(true);
    expect(canAccess('MANAGER', '/caixa')).toBe(true);
    expect(canAccess('WAITER', '/caixa')).toBe(false);
    expect(canAccess('KITCHEN', '/caixa')).toBe(false);
    // Couriers see only their own route; no board, no orders (LGPD).
    expect(canAccess('COURIER', '/entregas')).toBe(true);
    expect(canAccess('COURIER', '/pedidos')).toBe(false);
    expect(canAccess('COURIER', '/entregadores')).toBe(false);
    expect(canAccess('OWNER', '/entregas')).toBe(false);
    expect(canAccess('CASHIER', '/entregadores')).toBe(true);
    expect(canAccess('CASHIER', '/areas-entrega')).toBe(true);
    expect(canAccess('CASHIER', '/entregadores/relatorio')).toBe(false);
    expect(canAccess('MANAGER', '/entregadores/relatorio')).toBe(true);
  });

  it('sends each role to its home', () => {
    expect(homeFor('OWNER')).toBe('/painel');
    expect(homeFor('WAITER')).toBe('/pedidos');
    expect(homeFor('COURIER')).toBe('/entregas');
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
    expect(safeNext('/configuracoes/usuarios', 'WAITER')).toBe('/pedidos');
    expect(safeNext(null, 'COURIER')).toBe('/entregas');
    expect(safeNext('/pedidos', 'COURIER')).toBe('/entregas');
  });
});
