import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  decryptSecret,
  encryptSecret,
  hotp,
  newRecoveryCode,
  newTotpSecret,
  normalizeRecoveryCode,
  otpauthUrl,
  parseSecretsKey,
  totp,
  verifyTotp,
} from './two-factor.js';

// RFC 6238 appendix B (SHA1 seed "12345678901234567890").
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 4226 and RFC 6238 test vectors', () => {
    const seed = Buffer.from('12345678901234567890');
    expect([0, 1, 2, 9].map((c) => hotp(seed, c))).toEqual([
      '755224',
      '287082',
      '359152',
      '520489',
    ]);
    expect(hotp(seed, 1, 8)).toBe('94287082');
    // 8-digit vectors at T = 59 and 1111111109 end with these 6 digits.
    expect(totp(RFC_SECRET, new Date(59_000))).toBe('287082');
    expect(totp(RFC_SECRET, new Date(1_111_111_109_000))).toBe('081804');
  });

  it('round-trips base32', () => {
    const data = randomBytes(20);
    expect(base32Decode(base32Encode(data))).toEqual(data);
    expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
    expect(() => base32Decode('abc1')).toThrow(RangeError);
  });

  it('accepts the adjacent codes once and never the same code twice', () => {
    const now = new Date('2026-10-11T15:00:10Z');
    const secret = newTotpSecret();
    const previous = totp(secret, new Date(now.getTime() - 30_000));
    const counter = verifyTotp(secret, previous, now);
    expect(counter).not.toBeNull();
    expect(verifyTotp(secret, previous, now, counter)).toBeNull();
    expect(verifyTotp(secret, totp(secret, now), now, counter)).toBe(counter! + 1);
    expect(verifyTotp(secret, totp(secret, new Date(now.getTime() - 90_000)), now)).toBeNull();
    expect(verifyTotp(secret, 'abc123', now)).toBeNull();
  });

  it('builds the otpauth link for the QR code', () => {
    expect(otpauthUrl('Plataforma', 'admin@x.com', 'ABC')).toBe(
      'otpauth://totp/Plataforma%3Aadmin%40x.com?secret=ABC&issuer=Plataforma&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('recovery codes', () => {
  it('are readable, unique and tolerant to typing', () => {
    const codes = new Set(Array.from({ length: 50 }, newRecoveryCode));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(normalizeRecoveryCode(' k7q2m 9xh4p ')).toBe('K7Q2M-9XH4P');
    expect(normalizeRecoveryCode('K7Q2MOXH4P')).toBe('K7Q2M-0XH4P');
  });
});

describe('secret encryption', () => {
  const key = randomBytes(32);

  it('encrypts with a fresh IV and detects tampering or a wrong key', () => {
    const a = encryptSecret('JBSWY3DPEHPK3PXP', key);
    const b = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('JBSWY3DPEHPK3PXP');
    const [v, iv, tag, data] = a.split(':');
    const tampered = [v, iv, tag, `${data!.slice(0, -2)}AA`].join(':');
    expect(() => decryptSecret(tampered, key)).toThrow();
    expect(() => decryptSecret(a, randomBytes(32))).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(parseSecretsKey(key.toString('base64url'))).toEqual(key);
    expect(() => parseSecretsKey(undefined)).toThrow(/PLATFORM_SECRETS_KEY/);
    expect(() => parseSecretsKey(randomBytes(16).toString('base64url'))).toThrow();
  });
});
