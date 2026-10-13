import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { BRAND } from '@app/shared';
import { PRODUCTION_SECRETS, productionProblems, validateEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  PLATFORM_JWT_SECRET: 'c'.repeat(32),
  PLATFORM_SECRETS_KEY: Buffer.alloc(32, 1).toString('base64url'),
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

describe('production settings', () => {
  const secret = (seed: string) => createHash('sha256').update(seed).digest('base64url');
  const production = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://app:s3nh4-gerada@172.30.0.1:5432/app_db',
    JWT_ACCESS_SECRET: secret('a'),
    JWT_REFRESH_SECRET: secret('b'),
    PLATFORM_JWT_SECRET: secret('c'),
    PLATFORM_SECRETS_KEY: randomBytes(32).toString('base64url'),
    MENU_REVALIDATE_SECRET: secret('d'),
    API_PUBLIC_URL: 'https://api.203-0-113-10.sslip.io',
    WEB_PUBLIC_URL: 'https://painel.203-0-113-10.sslip.io',
    MENU_PUBLIC_URL: 'https://cardapio.203-0-113-10.sslip.io',
    ADMIN_PUBLIC_URL: 'https://admin.203-0-113-10.sslip.io',
    SMTP_TLS: 'starttls',
  };

  it('accepts generated secrets and public addresses', () => {
    expect(productionProblems(validateEnv(production))).toEqual([]);
  });

  it('refuses every development secret of .env.example', () => {
    const example = readFileSync(
      path.join(import.meta.dirname, '../../../../../.env.example'),
      'utf8',
    );
    for (const key of PRODUCTION_SECRETS) {
      const value = new RegExp(`^${key}=(.*)$`, 'm').exec(example)?.[1];
      expect(value, key).toBeTruthy();
      expect(() => validateEnv({ ...production, [key]: value }), key).toThrow(
        new RegExp(`Configuração de produção recusada[\\s\\S]*${key}`),
      );
    }
  });

  it('home network server (LAN_SERVER): its Mailpit without TLS, but never development secrets', () => {
    const lan = {
      ...production,
      LAN_SERVER: 'true',
      SMTP_TLS: 'none',
      WEB_PUBLIC_URL: 'http://192.168.0.92:3000',
    };
    expect(productionProblems(validateEnv(lan))).toEqual([]);
    expect(() =>
      validateEnv({ ...lan, JWT_ACCESS_SECRET: 'dev-only-access-secret-change-me-please' }),
    ).toThrow(/JWT_ACCESS_SECRET/);
    expect(validateEnv(production).LAN_SERVER).toBe(false);
  });

  it('refuses the development database password, local addresses and e-mail without TLS', () => {
    expect(() =>
      validateEnv({ ...production, DATABASE_URL: 'postgresql://app:app_dev@localhost/app_db' }),
    ).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...production, WEB_PUBLIC_URL: 'http://localhost:3000' })).toThrow(
      /WEB_PUBLIC_URL: endereço local/,
    );
    expect(() => validateEnv({ ...production, SMTP_TLS: 'none' })).toThrow(/SMTP_TLS/);
    expect(() => validateEnv({ ...production, MENU_REVALIDATE_SECRET: '' })).toThrow(
      /MENU_REVALIDATE_SECRET: vazio/,
    );
  });

  it('does not apply outside production (development and the tests)', () => {
    expect(productionProblems(validateEnv({ ...base, SMTP_TLS: 'none' }))).toEqual([]);
  });
});
