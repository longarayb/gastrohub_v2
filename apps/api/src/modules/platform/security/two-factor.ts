import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Two-factor authentication of platform admins (D041): TOTP (RFC 6238: HMAC-SHA1, 30 s,
 * 6 digits), compatible with Google Authenticator, Microsoft Authenticator, 1Password etc.
 * No external dependency: the algorithm is small and tested against the RFC vectors.
 */

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accepts the previous and the next code too (clock drift of the phone). */
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new RangeError('Segredo inválido');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** New random secret (160 bits, as recommended by RFC 4226), base32. */
export const newTotpSecret = (): string => base32Encode(randomBytes(20));

/** HOTP value (RFC 4226) for a counter. */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', secret).update(message).digest();
  const offset = hash[hash.length - 1]! & 0x0f;
  const code =
    ((hash[offset]! & 0x7f) << 24) |
    (hash[offset + 1]! << 16) |
    (hash[offset + 2]! << 8) |
    hash[offset + 3]!;
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const totpCounter = (now: Date): number =>
  Math.floor(now.getTime() / 1000 / TOTP_PERIOD_SECONDS);

export function totp(secretBase32: string, now: Date = new Date()): string {
  return hotp(base32Decode(secretBase32), totpCounter(now));
}

/**
 * Checks a 6-digit code. Returns the counter that matched (store it: a code is never accepted
 * twice, RFC 6238 §5.2) or null.
 */
export function verifyTotp(
  secretBase32: string,
  code: string,
  now: Date = new Date(),
  lastUsedCounter: number | null = null,
): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const secret = base32Decode(secretBase32);
  const current = totpCounter(now);
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta++) {
    const counter = current + delta;
    if (lastUsedCounter != null && counter <= lastUsedCounter) continue;
    const expected = Buffer.from(hotp(secret, counter));
    if (timingSafeEqual(expected, Buffer.from(clean))) return counter;
  }
  return null;
}

/** otpauth:// link shown as a QR code when enrolling the authenticator app. */
export function otpauthUrl(issuer: string, account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Recovery codes: 10 single-use codes, shown once, stored hashed (argon2 by the service).

const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const RECOVERY_CODE_COUNT = 10;

/** "K7Q2M-9XH4P" (50 bits of entropy). */
export function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  let code = '';
  for (let i = 0; i < 10; i++) code += RECOVERY_ALPHABET[bytes[i]! & 31];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Normalizes what the admin typed: case, spaces, dashes and look-alike letters. */
export const normalizeRecoveryCode = (input: string): string => {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return clean.length === 10 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
};

// ---------------------------------------------------------------------------
// Secret encryption at rest (AES-256-GCM). The key (PLATFORM_SECRETS_KEY, 32 bytes base64url)
// lives only in the environment: losing it means every admin must reset the 2FA with the
// emergency command (docs/SETUP.md).

export function parseSecretsKey(value: string | undefined): Buffer {
  const key = value ? Buffer.from(value, 'base64url') : Buffer.alloc(0);
  if (key.length !== 32) {
    throw new Error('PLATFORM_SECRETS_KEY precisa ter 32 bytes em base64url (veja o .env.example)');
  }
  return key;
}

export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    'v1',
    iv.toString('base64url'),
    tag.toString('base64url'),
    data.toString('base64url'),
  ].join(':');
}

export function decryptSecret(sealed: string, key: Buffer): string {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== 'v1' || !iv || !tag || !data)
    throw new Error('Segredo cifrado em formato desconhecido');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
