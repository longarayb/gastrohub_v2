/**
 * Money helpers. All monetary values in the system are integers in cents (BRL).
 * Percentages are expressed in basis points (1% = 100 bps, 10% = 1000 bps).
 */

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const decimalFormatter = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Formats cents as BRL currency: 123456 -> "R$ 1.234,56". Uses regular spaces. */
export function formatBRL(cents: number): string {
  return brlFormatter.format(cents / 100).replace(/\s/g, ' ');
}

/** Formats cents as a decimal number without the currency symbol: 123456 -> "1.234,56". */
export function formatDecimalBRL(cents: number): string {
  return decimalFormatter.format(cents / 100);
}

/**
 * Parses user input in Brazilian format into cents.
 * Accepts "R$ 1.234,56", "1234,56", "1234.56", "12", "-5,5".
 * Returns `null` when the input is not a valid amount.
 */
export function parseBRL(input: string): number | null {
  let value = input
    .trim()
    .replace(/^R\$\s*/i, '')
    .replace(/\s/g, '');
  if (value === '') return null;

  const negative = value.startsWith('-');
  if (negative) value = value.slice(1);

  if (value.includes(',')) {
    // Brazilian format: dots are thousand separators, comma is the decimal separator.
    value = value.replace(/\./g, '').replace(',', '.');
  } else if ((value.match(/\./g) ?? []).length > 1) {
    value = value.replace(/\./g, '');
  } else if (/^\d{1,3}\.\d{3}$/.test(value)) {
    // "1.234" is a thousand separator in pt-BR, not a decimal.
    value = value.replace('.', '');
  }

  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;

  const [intPart = '0', fracPart = ''] = value.split('.');
  const cents = Number(intPart) * 100 + Number(fracPart.padEnd(2, '0'));
  return negative ? -cents : cents;
}

/** Converts a decimal amount in reais to cents, rounding to the nearest cent. */
export function toCents(reais: number): number {
  return Math.round(reais * 100);
}

/** Rounds half away from zero to an integer. */
function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/** Applies a percentage in basis points to an amount in cents: (1000, 1000bps) -> 100. */
export function applyBasisPoints(cents: number, basisPoints: number): number {
  return roundHalfUp((cents * basisPoints) / 10_000);
}

/**
 * Splits an amount into `parts` integer shares that sum exactly to the total.
 * Remainder cents go to the first shares: allocate(1000, 3) -> [334, 333, 333].
 */
export function allocateEvenly(cents: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new RangeError('parts must be a positive integer');
  }
  const base = Math.trunc(cents / parts);
  const remainder = cents - base * parts;
  const step = Math.sign(remainder);
  return Array.from({ length: parts }, (_, i) => base + (i < Math.abs(remainder) ? step : 0));
}

/**
 * Splits an amount proportionally to the given weights, summing exactly to the total.
 * Uses the largest remainder method.
 */
export function allocateByWeights(cents: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (weights.length === 0) return [];
  if (totalWeight <= 0) return allocateEvenly(cents, weights.length);

  const raw = weights.map((w) => (cents * w) / totalWeight);
  const result = raw.map((v) => Math.floor(v));
  let remainder = cents - result.reduce((sum, v) => sum + v, 0);

  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (const { i } of order) {
    if (remainder <= 0) break;
    result[i] = (result[i] ?? 0) + 1;
    remainder--;
  }
  return result;
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0);
}
