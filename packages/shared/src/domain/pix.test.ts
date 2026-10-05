import { describe, expect, it } from 'vitest';
import { buildPixBrCode, crc16, isValidPixTxid, normalizePixKey, pixText } from './pix.js';

/** Static example of the BCB manual (Manual de Padrões para Iniciação do Pix, BR Code). */
const BCB_EXAMPLE =
  '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR' +
  '5913Fulano de Tal6008BRASILIA62070503***63041D3D';

describe('crc16', () => {
  it('matches the CRC-16/CCITT-FALSE check value', () => {
    expect(crc16('123456789')).toBe('29B1');
  });

  it('matches the CRC of the official BCB example', () => {
    expect(crc16(BCB_EXAMPLE.slice(0, -4))).toBe('1D3D');
  });
});

describe('buildPixBrCode', () => {
  const base = {
    key: '123e4567-e12b-12d1-a456-426655440000',
    merchantName: 'Fulano de Tal',
    merchantCity: 'Brasília',
  };

  it('builds a payload with the BCB field layout and a valid CRC', () => {
    const code = buildPixBrCode(base);
    // Same fields as the BCB example (name and city are normalized to uppercase ASCII).
    expect(code).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR' +
        `5913FULANO DE TAL6008BRASILIA62070503***6304${crc16(code.slice(0, -4))}`,
    );
    expect(code.slice(-4)).toMatch(/^[0-9A-F]{4}$/);
  });

  it('includes the amount with two decimals and the txid', () => {
    const code = buildPixBrCode({ ...base, amountCents: 12345, txid: 'AB12CD34' });
    expect(code).toContain('5406123.45');
    expect(code).toContain('62120508AB12CD34');
    expect(crc16(code.slice(0, -4))).toBe(code.slice(-4));
  });

  it('omits the amount when it is zero', () => {
    expect(buildPixBrCode({ ...base, amountCents: 0 })).not.toContain('5404');
  });

  it('truncates name (25) and city (15) as the BR Code requires', () => {
    const code = buildPixBrCode({
      ...base,
      merchantName: 'Pizzaria e Restaurante do João Ltda',
      merchantCity: 'São José dos Campos',
    });
    expect(code).toContain('5925PIZZARIA E RESTAURANTE D');
    expect(code).toContain('6015SAO JOSE DOS CA');
  });

  it('accepts a txid of exactly 25 alphanumeric characters', () => {
    const txid = 'A'.repeat(25);
    expect(buildPixBrCode({ ...base, txid })).toContain(`62290525${txid}6304`);
  });

  it('rejects a txid longer than 25 characters or with symbols', () => {
    expect(() => buildPixBrCode({ ...base, txid: 'A'.repeat(26) })).toThrow(/25/);
    expect(() => buildPixBrCode({ ...base, txid: 'PED-12' })).toThrow(/25/);
  });

  it('rejects missing data and invalid amounts', () => {
    expect(() => buildPixBrCode({ ...base, key: '' })).toThrow();
    expect(() => buildPixBrCode({ ...base, merchantName: ' ' })).toThrow();
    expect(() => buildPixBrCode({ ...base, amountCents: 10.5 })).toThrow();
  });
});

describe('isValidPixTxid', () => {
  it('accepts the order public code format (8 alphanumeric)', () => {
    expect(isValidPixTxid('7K2M9QXT')).toBe(true);
  });
  it('rejects empty, long or non-alphanumeric values', () => {
    expect(isValidPixTxid('')).toBe(false);
    expect(isValidPixTxid('A'.repeat(26))).toBe(false);
    expect(isValidPixTxid('ABC 123')).toBe(false);
  });
});

describe('normalizePixKey', () => {
  it('normalizes CPF and CNPJ to digits and validates them', () => {
    expect(normalizePixKey('CPF', '529.982.247-25')).toBe('52998224725');
    expect(normalizePixKey('CPF', '111.111.111-11')).toBeNull();
    expect(normalizePixKey('CNPJ', '11.222.333/0001-81')).toBe('11222333000181');
  });

  it('normalizes e-mail, phone and random keys', () => {
    expect(normalizePixKey('EMAIL', ' Caixa@Restaurante.com ')).toBe('caixa@restaurante.com');
    expect(normalizePixKey('EMAIL', 'sem-arroba')).toBeNull();
    expect(normalizePixKey('PHONE', '(11) 98765-4321')).toBe('+5511987654321');
    expect(normalizePixKey('PHONE', '+55 11 98765-4321')).toBe('+5511987654321');
    expect(normalizePixKey('PHONE', '123')).toBeNull();
    expect(normalizePixKey('RANDOM', '123E4567-E12B-12D1-A456-426655440000')).toBe(
      '123e4567-e12b-12d1-a456-426655440000',
    );
    expect(normalizePixKey('RANDOM', 'nao-e-uuid')).toBeNull();
  });
});

describe('pixText', () => {
  it('removes accents and symbols', () => {
    expect(pixText('Café & Cia.', 25)).toBe('CAFE CIA');
  });
});
