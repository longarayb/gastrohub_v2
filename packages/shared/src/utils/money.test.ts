import { describe, expect, it } from 'vitest';
import {
  allocateByWeights,
  allocateEvenly,
  applyBasisPoints,
  formatBRL,
  formatDecimalBRL,
  parseBRL,
  toCents,
} from './money.js';

describe('formatBRL', () => {
  it('formats cents as BRL', () => {
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(5)).toBe('R$ 0,05');
    expect(formatDecimalBRL(100000000)).toBe('1.000.000,00');
  });

  it('formats negative values', () => {
    expect(formatBRL(-1050)).toBe('-R$ 10,50');
  });
});

describe('parseBRL', () => {
  it.each([
    ['R$ 1.234,56', 123456],
    ['1234,56', 123456],
    ['1234.56', 123456],
    ['12', 1200],
    ['12,5', 1250],
    ['0,05', 5],
    ['1.234', 123400],
    ['1.234.567,89', 123456789],
    ['-5,50', -550],
  ])('parses %s', (input, expected) => {
    expect(parseBRL(input)).toBe(expected);
  });

  it.each(['', 'abc', '12,345', '1,2,3'])('rejects %s', (input) => {
    expect(parseBRL(input)).toBeNull();
  });
});

describe('toCents', () => {
  it('avoids floating point errors', () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
  });
});

describe('applyBasisPoints', () => {
  it('computes percentages with half-up rounding', () => {
    expect(applyBasisPoints(10000, 1000)).toBe(1000); // 10%
    expect(applyBasisPoints(1005, 1000)).toBe(101); // 100.5 -> 101
    expect(applyBasisPoints(1234, 0)).toBe(0);
  });
});

describe('allocateEvenly', () => {
  it('splits keeping the exact total', () => {
    expect(allocateEvenly(1000, 3)).toEqual([334, 333, 333]);
    expect(allocateEvenly(100, 4)).toEqual([25, 25, 25, 25]);
    expect(allocateEvenly(1, 3)).toEqual([1, 0, 0]);
  });

  it('rejects invalid parts', () => {
    expect(() => allocateEvenly(100, 0)).toThrow(RangeError);
  });
});

describe('allocateByWeights', () => {
  it('splits proportionally keeping the exact total', () => {
    const result = allocateByWeights(1000, [1, 1, 1]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(allocateByWeights(1000, [3000, 1000])).toEqual([750, 250]);
    expect(allocateByWeights(100, [1, 2])).toEqual([33, 67]);
  });
});
