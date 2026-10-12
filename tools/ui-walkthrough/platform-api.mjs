// Platform admin API helpers for the walkthroughs (demo admin from the seed, KNOWN 2FA secret).
import { createHmac } from 'node:crypto';

export const API = process.env.WALKTHROUGH_API ?? 'http://localhost:3333/api';
export const ADMIN_URL = process.env.WALKTHROUGH_ADMIN ?? 'http://localhost:3002';
export const PLATFORM_ADMIN = {
  email: 'admin@plataforma.local',
  password: 'Plataforma123',
  totpSecret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
};

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of text.replace(/=+$/, '')) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** TOTP code (RFC 6238) for a time step offset (0 = now, 1 = next 30 s). */
export function totp(secret = PLATFORM_ADMIN.totpSecret, step = 0) {
  const counter = Math.floor(Date.now() / 30_000) + step;
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const hash = createHmac('sha1', base32Decode(secret)).update(message).digest();
  const offset = hash[hash.length - 1] & 0x0f;
  const code =
    ((hash[offset] & 0x7f) << 24) |
    (hash[offset + 1] << 16) |
    (hash[offset + 2] << 8) |
    hash[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

let usedStep = -1;
/** A code never used before in this run (the API refuses a code twice). */
export function freshCode() {
  usedStep = Math.max(usedStep + 1, 0);
  // Codes of the current window and the next one are accepted (window ±1).
  if (usedStep > 1) throw new Error('Sem código novo: espere 30 s');
  return totp(PLATFORM_ADMIN.totpSecret, usedStep);
}

/** Signs in as the demo platform admin through the API (password + TOTP). */
export async function adminToken(code = freshCode()) {
  const login = await fetch(`${API}/platform/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: PLATFORM_ADMIN.email, password: PLATFORM_ADMIN.password }),
  }).then((r) => r.json());
  const res = await fetch(`${API}/platform/auth/2fa/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ challenge: login.challenge, code }),
  });
  if (!res.ok) throw new Error(`admin 2FA: ${res.status} ${await res.text()}`);
  return (await res.json()).accessToken;
}

export async function adminCall(token, method, path, body) {
  const res = await fetch(`${API}/platform${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  return data;
}

/** Opens or closes the public signup (the default is invite only, D043). */
export async function setSignupMode(token, mode) {
  const settings = await adminCall(token, 'GET', '/settings');
  const plans = await adminCall(token, 'GET', '/plans');
  const plan = settings.signupPlanId ?? plans.find((p) => p.isActive)?.id ?? null;
  return adminCall(token, 'PUT', '/settings', {
    ...settings,
    signupMode: mode,
    signupPlanId: plan,
  });
}
