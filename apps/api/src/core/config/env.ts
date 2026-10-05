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

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  MAIL_FROM_ADDRESS: z.email().default('nao-responda@app.local'),

  WEB_PUBLIC_URL: z.url().default('http://localhost:3000'),
  MENU_PUBLIC_URL: z.url().default('http://localhost:3001'),
  STORAGE_DIR: z.string().default('uploads'),

  GEOCODING_PROVIDER: z.enum(['nominatim', 'none']).default('nominatim'),
  NOMINATIM_URL: z.url().default('https://nominatim.openstreetmap.org'),
  NOMINATIM_EMAIL: z.string().default(''),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Variáveis de ambiente inválidas:\n${issues.join('\n')}`);
  }
  return result.data;
}
