import { describe, expect, it } from 'vitest';
import { moveItemsPlan, splitEvenly, splitLine, type SplittableLine } from './bill-split.js';

describe('splitEvenly', () => {
  it('gives the leftover cents to the first shares', () => {
    expect(splitEvenly(10_000, 3)).toEqual([3_334, 3_333, 3_333]);
    expect(splitEvenly(10_001, 2)).toEqual([5_001, 5_000]);
    expect(splitEvenly(9_000, 3)).toEqual([3_000, 3_000, 3_000]);
  });

  it('always sums to the balance', () => {
    for (const people of [2, 3, 4, 7, 11]) {
      expect(splitEvenly(12_347, people).reduce((a, b) => a + b, 0)).toBe(12_347);
    }
  });

  it('validates the number of people', () => {
    expect(() => splitEvenly(1_000, 0)).toThrow();
    expect(() => splitEvenly(1_000, 31)).toThrow();
    expect(splitEvenly(1_000, 1)).toEqual([1_000]);
  });
});

const line = (extra: Partial<SplittableLine> = {}): SplittableLine => ({
  id: 'i1',
  status: 'QUEUED',
  quantity: 3,
  unitChargedPriceCents: 1_000,
  discountType: null,
  discountValue: null,
  ...extra,
});

describe('splitLine', () => {
  it('breaks a line by quantity', () => {
    expect(splitLine(line(), 1)).toEqual({
      keep: { quantity: 2, discountValue: null, discountCents: 0, totalCents: 2_000 },
      move: { quantity: 1, discountValue: null, discountCents: 0, totalCents: 1_000 },
    });
  });

  it('shares a value discount in proportion to the quantities', () => {
    const { keep, move } = splitLine(line({ discountType: 'VALUE', discountValue: 500 }), 1);
    // 500 × 2/3 = 333,3 → 334 (largest remainder), 500 × 1/3 = 166,6 → 166... sums to 500
    expect(keep.discountValue! + move.discountValue!).toBe(500);
    expect(keep.totalCents + move.totalCents).toBe(3_000 - 500);
  });

  it('keeps a percent discount on both parts', () => {
    const { keep, move } = splitLine(line({ discountType: 'PERCENT', discountValue: 1000 }), 2);
    expect(keep).toEqual({ quantity: 1, discountValue: 1000, discountCents: 100, totalCents: 900 });
    expect(move).toEqual({
      quantity: 2,
      discountValue: 1000,
      discountCents: 200,
      totalCents: 1_800,
    });
  });

  it('rejects moving zero or all units (that is a whole move)', () => {
    expect(() => splitLine(line(), 0)).toThrow();
    expect(() => splitLine(line(), 3)).toThrow();
  });
});

describe('moveItemsPlan', () => {
  const lines = [
    line({ id: 'a', quantity: 2 }),
    line({ id: 'b', quantity: 1 }),
    line({ id: 'c', status: 'CANCELED' }),
  ];

  it('moves whole lines and breaks partial ones', () => {
    const result = moveItemsPlan(lines, [
      { itemId: 'a', quantity: 1 },
      { itemId: 'b', quantity: 1 },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.whole).toEqual(['b']);
    expect(result.plan.partial).toHaveLength(1);
    expect(result.plan.partial[0]!.itemId).toBe('a');
    expect(result.plan.partial[0]!.move.quantity).toBe(1);
  });

  it('rejects canceled, unknown, repeated and over-quantity selections', () => {
    expect(moveItemsPlan(lines, [])).toEqual({ ok: false, message: 'Selecione os itens' });
    expect(moveItemsPlan(lines, [{ itemId: 'c', quantity: 1 }]).ok).toBe(false);
    expect(moveItemsPlan(lines, [{ itemId: 'x', quantity: 1 }]).ok).toBe(false);
    expect(moveItemsPlan(lines, [{ itemId: 'a', quantity: 3 }]).ok).toBe(false);
    expect(
      moveItemsPlan(lines, [
        { itemId: 'b', quantity: 1 },
        { itemId: 'b', quantity: 1 },
      ]).ok,
    ).toBe(false);
  });
});
