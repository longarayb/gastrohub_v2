import { BRAND } from '@app/shared';
import { validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('falls back to the brand name when APP_NAME is missing or empty', () => {
    expect(validateEnv(base).APP_NAME).toBe(BRAND.name);
    expect(validateEnv({ ...base, APP_NAME: '' }).APP_NAME).toBe(BRAND.name);
    expect(validateEnv({ ...base, APP_NAME: '  ' }).APP_NAME).toBe(BRAND.name);
    expect(validateEnv({ ...base, APP_NAME: 'Outro Nome' }).APP_NAME).toBe('Outro Nome');
  });

  it('keeps the production login limit (10/min) unless configured', () => {
    expect(validateEnv(base).LOGIN_RATE_LIMIT_PER_MINUTE).toBe(10);
    expect(
      validateEnv({ ...base, LOGIN_RATE_LIMIT_PER_MINUTE: '' }).LOGIN_RATE_LIMIT_PER_MINUTE,
    ).toBe(10);
    expect(
      validateEnv({ ...base, LOGIN_RATE_LIMIT_PER_MINUTE: '300' }).LOGIN_RATE_LIMIT_PER_MINUTE,
    ).toBe(300);
    expect(() => validateEnv({ ...base, LOGIN_RATE_LIMIT_PER_MINUTE: '0' })).toThrow();
  });

  it('rejects short JWT secrets with a readable message', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'curto' })).toThrow(
      /Variáveis de ambiente inválidas/,
    );
  });
});
