import { describe, expect, it } from 'vitest';
import {
  PLATFORM_PRIVACY_VERSION,
  PLATFORM_TERMS_VERSION,
  hasModule,
  isReadOnlyMethod,
  needsTermsAcceptance,
  supportSessionEndsAt,
} from './platform.js';

describe('platform rules', () => {
  it('asks the owner to accept again when any text changes', () => {
    const current = {
      termsVersion: PLATFORM_TERMS_VERSION,
      privacyVersion: PLATFORM_PRIVACY_VERSION,
    };
    expect(needsTermsAcceptance(null)).toBe(true);
    expect(needsTermsAcceptance(current)).toBe(false);
    expect(needsTermsAcceptance({ ...current, termsVersion: '2020-01-01' })).toBe(true);
    expect(needsTermsAcceptance({ ...current, privacyVersion: '2020-01-01' })).toBe(true);
  });

  it('checks plan modules', () => {
    expect(hasModule(['DIGITAL_MENU', 'KDS'], 'KDS')).toBe(true);
    expect(hasModule(['DIGITAL_MENU'], 'PRINTING')).toBe(false);
  });

  it('limits support sessions to 15–60 minutes', () => {
    const start = new Date('2026-10-11T15:00:00Z');
    expect(supportSessionEndsAt(start, 30)).toEqual(new Date('2026-10-11T15:30:00Z'));
    expect(supportSessionEndsAt(start, 600)).toEqual(new Date('2026-10-11T16:00:00Z'));
    expect(supportSessionEndsAt(start, 1)).toEqual(new Date('2026-10-11T15:15:00Z'));
    expect(isReadOnlyMethod('get')).toBe(true);
    expect(isReadOnlyMethod('POST')).toBe(false);
  });
});

describe('customer data schema', () => {
  it('accepts an empty optional contact e-mail', async () => {
    const { customerDataSchema } = await import('../platform/schemas.js');
    const base = {
      name: 'Cliente',
      document: '11222333000181',
      legalName: 'Cliente LTDA',
      invoiceEmail: 'nota@cliente.test',
      contactName: 'Contato',
      contactPhone: '11987654321',
      address: {
        cep: '01310100',
        street: 'Rua',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
      },
    };
    expect(customerDataSchema.parse({ ...base, contactEmail: '' }).contactEmail).toBeNull();
    expect(customerDataSchema.parse({ ...base, contactEmail: 'a@b.com' }).contactEmail).toBe(
      'a@b.com',
    );
    expect(customerDataSchema.safeParse({ ...base, contactEmail: 'x' }).success).toBe(false);
  });
});
