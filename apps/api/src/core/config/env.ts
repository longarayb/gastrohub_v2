import { BRAND } from '@app/shared';
import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const envSchema = z.object({
  /** Display name used in e-mails and the API docs. Defaults to BRAND.name. */
  APP_NAME: z
    .string()
    .trim()
    .transform((v) => v || BRAND.name)
    .default(BRAND.name),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /**
   * Production build serving a home network over plain http (the Surface server, docs/SETUP.md):
   * cookies without Secure and e-mail to the local Mailpit. Development secrets are still refused.
   */
  LAN_SERVER: z
    .enum(['true', 'false', ''])
    .default('false')
    .transform((v) => v === 'true'),
  API_PORT: z.coerce.number().int().default(3333),
  /** Login attempts per minute and IP (brute force protection). Production: 10. */
  LOGIN_RATE_LIMIT_PER_MINUTE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).default(10),
  ),
  API_PUBLIC_URL: z.url().default('http://localhost:3333'),
  API_CORS_ORIGINS: csv,

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  /** Prefix of the BullMQ keys in Redis (tests use their own, apart from a running dev API). */
  QUEUE_PREFIX: z.string().min(1).default('bull'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** Platform admin (D041): own token secret, never the restaurants' one. */
  PLATFORM_JWT_SECRET: z.string().min(32),
  /** 32 bytes (base64url) encrypting the admins' 2FA secrets (AES-256-GCM). */
  PLATFORM_SECRETS_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64url').length === 32, 'precisa ter 32 bytes em base64url'),
  ADMIN_PUBLIC_URL: z.url().default('http://localhost:3002'),
  PLATFORM_LOGIN_RATE_LIMIT_PER_MINUTE: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.coerce.number().int().min(1).default(5),
  ),
  /** IPs allowed on the admin API; empty = any. */
  PLATFORM_ALLOWED_IPS: csv,

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  /** SMTP login (empty = none, as with Mailpit in development). */
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  /** none (Mailpit), starttls (port 587, e.g. Brevo) or tls (port 465). */
  SMTP_TLS: z.enum(['none', 'starttls', 'tls']).default('none'),
  MAIL_FROM_ADDRESS: z.email().default('nao-responda@app.local'),

  WEB_PUBLIC_URL: z.url().default('http://localhost:3000'),
  MENU_PUBLIC_URL: z.url().default('http://localhost:3001'),
  /** Where the API reaches the menu app to refresh its cache (internal network in production). */
  MENU_INTERNAL_URL: z.url().default('http://localhost:3001'),
  /** Shared secret of the menu cache refresh; empty disables it (the cache expires by itself). */
  MENU_REVALIDATE_SECRET: z.string().default(''),
  /** Express "trust proxy": which proxies may set X-Forwarded-For (real client IP). */
  TRUST_PROXY: z.string().default('loopback'),
  STORAGE_DIR: z.string().default('uploads'),

  GEOCODING_PROVIDER: z.enum(['nominatim', 'none']).default('nominatim'),
  NOMINATIM_URL: z.url().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_EMAIL: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

/** Secrets that must be generated for production (`deploy/gen-secrets.sh`). */
export const PRODUCTION_SECRETS = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'PLATFORM_JWT_SECRET',
  'PLATFORM_SECRETS_KEY',
  'MENU_REVALIDATE_SECRET',
] as const;

// The development values in .env.example all carry one of these marks (in plain text or, for the
// 2FA key, in base64url). env.test.ts checks every one of them is refused.
const DEV_MARKS = /dev-only|change-me|troque|desenvolvimento|app_dev/i;
const looksLikeDevSecret = (value: string) =>
  DEV_MARKS.test(value) || DEV_MARKS.test(Buffer.from(value, 'base64url').toString('latin1'));
const isLocal = (url: string) => /^https?:\/\/(localhost|127\.|0\.0\.0\.0)/i.test(url);

/**
 * Production refuses to start with development settings: a known secret would let anyone sign
 * tokens; a localhost address or e-mail without TLS means the .env was not filled in.
 */
export function productionProblems(env: Env): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  for (const key of PRODUCTION_SECRETS) {
    const value = env[key];
    if (!value) problems.push(`${key}: vazio (gere com deploy/gen-secrets.sh)`);
    else if (looksLikeDevSecret(value) || value.length < 32)
      problems.push(
        `${key}: valor de desenvolvimento ou curto demais (gere com deploy/gen-secrets.sh)`,
      );
  }
  if (DEV_MARKS.test(env.DATABASE_URL)) problems.push('DATABASE_URL: senha de desenvolvimento');
  for (const key of [
    'API_PUBLIC_URL',
    'WEB_PUBLIC_URL',
    'MENU_PUBLIC_URL',
    'ADMIN_PUBLIC_URL',
  ] as const) {
    if (isLocal(env[key])) problems.push(`${key}: endereço local (${env[key]})`);
  }
  // The home network server sends to its own Mailpit (no TLS); a real server never does.
  if (env.SMTP_TLS === 'none' && !env.LAN_SERVER) {
    problems.push('SMTP_TLS: e-mail sem criptografia (use starttls ou tls)');
  }
  return problems;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Variáveis de ambiente inválidas:\n${issues.join('\n')}`);
  }
  const problems = productionProblems(result.data);
  if (problems.length) {
    throw new Error(
      `Configuração de produção recusada:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
  return result.data;
}
