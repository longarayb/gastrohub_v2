import { onlyDigits } from './documents.js';

/**
 * Brazilian phone helpers. Phones are stored normalized as digits with DDD and
 * without country code: "11987654321" (mobile, 11 digits) or "1133334444" (landline, 10 digits).
 */

const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 24, 27, 28, 31, 32, 33, 34, 35, 37, 38, 41, 42, 43,
  44, 45, 46, 47, 48, 49, 51, 53, 54, 55, 61, 62, 63, 64, 65, 66, 67, 68, 69, 71, 73, 74, 75, 77,
  79, 81, 82, 83, 84, 85, 86, 87, 88, 89, 91, 92, 93, 94, 95, 96, 97, 98, 99,
]);

/** Strips formatting and the +55 country code. Returns digits only. */
export function normalizePhone(value: string): string {
  let digits = onlyDigits(value);
  if (digits.length >= 12 && digits.startsWith('55')) digits = digits.slice(2);
  // Long-distance prefix: 0 + DDD + number.
  if ((digits.length === 11 || digits.length === 12) && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits;
}

export function isValidPhone(value: string): boolean {
  const digits = normalizePhone(value);
  if (digits.length !== 10 && digits.length !== 11) return false;
  if (!VALID_DDDS.has(Number(digits.slice(0, 2)))) return false;
  // Mobile numbers have 9 digits starting with 9.
  if (digits.length === 11 && digits[2] !== '9') return false;
  // Landlines start with 2-5.
  if (digits.length === 10 && !/[2-5]/.test(digits[2] ?? '')) return false;
  return true;
}

/** "11987654321" -> "(11) 98765-4321"; "1133334444" -> "(11) 3333-4444". Formats partial input. */
export function formatPhone(value: string): string {
  const d = normalizePhone(value).slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const split = d.length === 11 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}
