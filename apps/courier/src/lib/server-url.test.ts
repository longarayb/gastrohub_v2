import { describe, expect, it } from 'vitest';
import { isInsecureRemote, normalizeServer } from './server-url';

describe('server address typed in the app', () => {
  it('accepts the home network IP, the hosted domain and what people paste', () => {
    expect(normalizeServer('192.168.0.92:3000')).toBe('http://192.168.0.92:3000');
    expect(normalizeServer(' http://192.168.0.92:3000/entregas ')).toBe('http://192.168.0.92:3000');
    expect(normalizeServer('painel.exemplo.com.br')).toBe('https://painel.exemplo.com.br');
    expect(normalizeServer('https://painel.exemplo.com.br/api/')).toBe(
      'https://painel.exemplo.com.br',
    );
    expect(normalizeServer('')).toBeNull();
    expect(normalizeServer('ftp://x')).toBeNull();
  });

  it('warns about http outside the home network', () => {
    expect(isInsecureRemote('http://192.168.0.92:3000')).toBe(false);
    expect(isInsecureRemote('https://painel.exemplo.com.br')).toBe(false);
    expect(isInsecureRemote('http://painel.exemplo.com.br')).toBe(true);
  });
});
