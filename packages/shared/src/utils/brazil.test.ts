import { describe, expect, it, vi } from 'vitest';
import { fetchAddressByCEP, formatCEP, isValidCEP } from './cep.js';
import { formatCNPJ, formatCPF, formatDocument, isValidCNPJ, isValidCPF } from './documents.js';
import { formatPhone, isValidPhone, normalizePhone } from './phone.js';
import { slugify } from './text.js';

describe('CPF', () => {
  it('validates check digits', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true);
    expect(isValidCPF('52998224725')).toBe(true);
    expect(isValidCPF('529.982.247-24')).toBe(false);
    expect(isValidCPF('111.111.111-11')).toBe(false);
    expect(isValidCPF('123')).toBe(false);
  });

  it('formats', () => {
    expect(formatCPF('52998224725')).toBe('529.982.247-25');
    expect(formatCPF('5299822')).toBe('529.982.2');
  });
});

describe('CNPJ', () => {
  it('validates check digits', () => {
    expect(isValidCNPJ('11.222.333/0001-81')).toBe(true);
    expect(isValidCNPJ('11222333000181')).toBe(true);
    expect(isValidCNPJ('11.222.333/0001-80')).toBe(false);
    expect(isValidCNPJ('00.000.000/0000-00')).toBe(false);
  });

  it('formats', () => {
    expect(formatCNPJ('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81');
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
  });
});

describe('phone', () => {
  it('normalizes', () => {
    expect(normalizePhone('+55 (11) 98765-4321')).toBe('11987654321');
    expect(normalizePhone('011987654321')).toBe('11987654321');
  });

  it('validates', () => {
    expect(isValidPhone('(11) 98765-4321')).toBe(true);
    expect(isValidPhone('(11) 3333-4444')).toBe(true);
    expect(isValidPhone('(11) 88765-4321')).toBe(false); // mobile must start with 9
    expect(isValidPhone('(20) 98765-4321')).toBe(false); // invalid DDD
    expect(isValidPhone('98765-4321')).toBe(false);
  });

  it('formats', () => {
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321');
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444');
    expect(formatPhone('119')).toBe('(11) 9');
  });
});

describe('CEP', () => {
  it('validates and formats', () => {
    expect(isValidCEP('01310-100')).toBe(true);
    expect(isValidCEP('0131010')).toBe(false);
    expect(formatCEP('01310100')).toBe('01310-100');
  });

  it('maps the ViaCEP response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        cep: '01310-100',
        logradouro: 'Avenida Paulista',
        complemento: 'de 612 a 1510 - lado par',
        bairro: 'Bela Vista',
        localidade: 'São Paulo',
        uf: 'SP',
        ibge: '3550308',
      }),
    });
    const address = await fetchAddressByCEP('01310-100', fetchMock as unknown as typeof fetch);
    expect(fetchMock).toHaveBeenCalledWith('https://viacep.com.br/ws/01310100/json/');
    expect(address).toMatchObject({
      street: 'Avenida Paulista',
      neighborhood: 'Bela Vista',
      state: 'SP',
    });
  });

  it('returns null for unknown CEP', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ erro: 'true' }) });
    expect(await fetchAddressByCEP('99999999', fetchMock as unknown as typeof fetch)).toBeNull();
  });
});

describe('slugify', () => {
  it('removes accents and symbols', () => {
    expect(slugify('Pizzaria do João!')).toBe('pizzaria-do-joao');
    expect(slugify('  Açaí & Cia  ')).toBe('acai-cia');
  });
});
