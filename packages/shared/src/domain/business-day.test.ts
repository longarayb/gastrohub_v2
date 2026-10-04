import { describe, expect, it } from 'vitest';
import { zonedTimeToInstant } from '../utils/datetime.js';
import { endOfBusinessDay, isWithinSchedule } from './business-day.js';

// São Paulo is UTC-3 (no DST). 2026-10-09 is a Friday, 2026-10-10 a Saturday.
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe('zonedTimeToInstant', () => {
  it('converts local wall time to an instant', () => {
    expect(zonedTimeToInstant('2026-10-09', 18 * 60).toISOString()).toBe(
      '2026-10-09T21:00:00.000Z',
    );
  });

  it('accepts minutes past midnight of the next day', () => {
    expect(zonedTimeToInstant('2026-10-09', 26 * 60).toISOString()).toBe(
      '2026-10-10T05:00:00.000Z',
    );
  });

  it('works for other time zones', () => {
    expect(zonedTimeToInstant('2026-01-15', 12 * 60, 'Europe/Lisbon').toISOString()).toBe(
      '2026-01-15T12:00:00.000Z',
    );
    // Lisbon summer time (UTC+1)
    expect(zonedTimeToInstant('2026-07-15', 12 * 60, 'Europe/Lisbon').toISOString()).toBe(
      '2026-07-15T11:00:00.000Z',
    );
  });
});

describe('endOfBusinessDay', () => {
  const nightShift = [
    { weekday: 5, opensAt: '18:00', closesAt: '02:00' }, // Fri 18:00 → Sat 02:00
    { weekday: 6, opensAt: '18:00', closesAt: '03:00' }, // Sat 18:00 → Sun 03:00
  ];

  it('during an overnight shift, ends when the shift ends (next calendar day)', () => {
    expect(endOfBusinessDay(nightShift, sp('2026-10-09T23:00:00'))).toEqual(
      sp('2026-10-10T02:00:00'),
    );
  });

  it('after midnight inside the shift, still belongs to the previous business day', () => {
    expect(endOfBusinessDay(nightShift, sp('2026-10-10T01:30:00'))).toEqual(
      sp('2026-10-10T02:00:00'),
    );
  });

  it('after closing, moves to the next business day', () => {
    // Sat 02:30: Friday's shift is over; next is Saturday's (ends Sun 03:00).
    expect(endOfBusinessDay(nightShift, sp('2026-10-10T02:30:00'))).toEqual(
      sp('2026-10-11T03:00:00'),
    );
  });

  it('before opening, ends at the end of today', () => {
    expect(endOfBusinessDay(nightShift, sp('2026-10-09T10:00:00'))).toEqual(
      sp('2026-10-10T02:00:00'),
    );
  });

  it('uses the last shift of a day with lunch and dinner', () => {
    const hours = [
      { weekday: 5, opensAt: '11:00', closesAt: '15:00' },
      { weekday: 5, opensAt: '18:00', closesAt: '23:30' },
    ];
    expect(endOfBusinessDay(hours, sp('2026-10-09T12:00:00'))).toEqual(sp('2026-10-09T23:30:00'));
  });

  it('skips closed days', () => {
    // Only Mondays (2026-10-12). From Friday, the next business day ends Monday 15:00.
    const hours = [{ weekday: 1, opensAt: '11:00', closesAt: '15:00' }];
    expect(endOfBusinessDay(hours, sp('2026-10-09T12:00:00'))).toEqual(sp('2026-10-12T15:00:00'));
  });

  it('falls back to the next local midnight without opening hours', () => {
    expect(endOfBusinessDay([], sp('2026-10-09T15:00:00'))).toEqual(sp('2026-10-10T00:00:00'));
  });
});

describe('isWithinSchedule', () => {
  const lateMenu = [{ weekday: 5, opensAt: '22:00', closesAt: '02:00' }];

  it('treats an empty schedule as always available', () => {
    expect(isWithinSchedule([], sp('2026-10-09T03:00:00'))).toBe(true);
  });

  it('supports windows crossing midnight', () => {
    expect(isWithinSchedule(lateMenu, sp('2026-10-09T21:59:00'))).toBe(false);
    expect(isWithinSchedule(lateMenu, sp('2026-10-09T23:00:00'))).toBe(true);
    expect(isWithinSchedule(lateMenu, sp('2026-10-10T01:59:00'))).toBe(true);
    expect(isWithinSchedule(lateMenu, sp('2026-10-10T02:00:00'))).toBe(false);
  });
});
