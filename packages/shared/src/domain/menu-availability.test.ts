import { describe, expect, it } from 'vitest';
import {
  type AvailabilityRules,
  SALES_CHANNELS,
  getProductAvailability,
  isPausedNow,
} from './menu-availability.js';

const sp = (iso: string) => new Date(`${iso}-03:00`);
const now = sp('2026-10-09T12:00:00'); // Friday noon

const rules = (overrides: Partial<AvailabilityRules> = {}): AvailabilityRules => ({
  isPaused: false,
  pausedUntil: null,
  channels: [...SALES_CHANNELS],
  schedules: [],
  ...overrides,
});

const codes = (r: ReturnType<typeof getProductAvailability>) => r.reasons.map((x) => x.code);

describe('isPausedNow', () => {
  it('handles indefinite, active and expired pauses', () => {
    expect(isPausedNow({ isPaused: false, pausedUntil: null }, now)).toBe(false);
    expect(isPausedNow({ isPaused: true, pausedUntil: null }, now)).toBe(true);
    expect(isPausedNow({ isPaused: true, pausedUntil: sp('2026-10-10T02:00:00') }, now)).toBe(true);
    expect(isPausedNow({ isPaused: true, pausedUntil: sp('2026-10-09T11:00:00') }, now)).toBe(
      false,
    );
  });
});

describe('getProductAvailability', () => {
  it('is available when nothing blocks it', () => {
    const r = getProductAvailability({
      category: rules(),
      product: rules(),
      channel: 'DELIVERY',
      now,
    });
    expect(r).toEqual({ available: true, reasons: [] });
  });

  it('reports pauses of category, product and size', () => {
    const r = getProductAvailability({
      category: rules({ isPaused: true }),
      product: rules({ isPaused: true, pausedUntil: sp('2026-10-10T02:00:00') }),
      size: { isPaused: true, pausedUntil: null },
      channel: 'DINE_IN',
      now,
    });
    expect(codes(r)).toEqual(['CATEGORY_PAUSED', 'PRODUCT_PAUSED', 'SIZE_PAUSED']);
    expect(r.reasons[1]?.message).toMatch(/^Produto pausado até sáb/);
  });

  it('ignores an expired "acabou" pause', () => {
    const r = getProductAvailability({
      category: rules(),
      product: rules({ isPaused: true, pausedUntil: sp('2026-10-09T02:00:00') }),
      channel: 'DINE_IN',
      now,
    });
    expect(r.available).toBe(true);
  });

  it('checks channels on both category and product', () => {
    const r = getProductAvailability({
      category: rules({ channels: ['DINE_IN', 'COUNTER'] }),
      product: rules({ channels: ['DINE_IN'] }),
      channel: 'COUNTER',
      now,
    });
    expect(codes(r)).toEqual(['PRODUCT_CHANNEL']);
    expect(r.reasons[0]?.message).toBe('Produto indisponível em: Balcão');
  });

  it('checks category and product schedules, including overnight windows', () => {
    const lunch = [{ weekday: 5, opensAt: '11:00', closesAt: '15:00' }];
    const lateNight = [{ weekday: 5, opensAt: '22:00', closesAt: '02:00' }];
    const base = { channel: 'DINE_IN' as const };

    expect(
      getProductAvailability({
        ...base,
        category: rules({ schedules: lunch }),
        product: rules(),
        now,
      }).available,
    ).toBe(true);
    expect(
      codes(
        getProductAvailability({
          ...base,
          category: rules(),
          product: rules({ schedules: lateNight }),
          now,
        }),
      ),
    ).toEqual(['PRODUCT_SCHEDULE']);
    expect(
      getProductAvailability({
        ...base,
        category: rules(),
        product: rules({ schedules: lateNight }),
        now: sp('2026-10-10T01:00:00'),
      }).available,
    ).toBe(true);
  });

  it('enforces store hours only when requested (digital menu)', () => {
    const storeHours = [{ weekday: 5, opensAt: '18:00', closesAt: '02:00' }];
    const input = { category: rules(), product: rules(), storeHours, now };
    expect(getProductAvailability({ ...input, channel: 'DINE_IN' }).available).toBe(true);
    expect(
      codes(getProductAvailability({ ...input, channel: 'DIGITAL_MENU', enforceStoreHours: true })),
    ).toEqual(['STORE_CLOSED']);
  });

  it('blocks deleted items', () => {
    const r = getProductAvailability({
      category: rules(),
      product: rules({ deletedAt: now }),
      channel: 'DINE_IN',
      now,
    });
    expect(codes(r)).toEqual(['DELETED']);
  });
});
