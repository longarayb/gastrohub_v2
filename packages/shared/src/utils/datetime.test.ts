import { describe, expect, it } from 'vitest';
import { minutesToTime, timeToMinutes, toBusinessDate, toLocalTime } from './datetime.js';

describe('toBusinessDate', () => {
  it('uses America/Sao_Paulo (UTC-3)', () => {
    // 02:30 UTC on Jan 16 is still 23:30 on Jan 15 in São Paulo.
    expect(toBusinessDate(new Date('2026-01-16T02:30:00Z'))).toBe('2026-01-15');
    expect(toBusinessDate(new Date('2026-01-16T03:30:00Z'))).toBe('2026-01-16');
  });
});

describe('toLocalTime', () => {
  it('returns local weekday and minutes', () => {
    // 2026-10-04 is a Sunday; 15:00Z -> 12:00 local.
    expect(toLocalTime(new Date('2026-10-04T15:00:00Z'))).toEqual({
      weekday: 0,
      minutes: 720,
      businessDate: '2026-10-04',
    });
  });
});

describe('time conversions', () => {
  it('converts HH:mm <-> minutes', () => {
    expect(timeToMinutes('18:30')).toBe(1110);
    expect(timeToMinutes('00:00')).toBe(0);
    expect(minutesToTime(1110)).toBe('18:30');
    expect(minutesToTime(1440 + 30)).toBe('00:30');
    expect(() => timeToMinutes('24:00')).toThrow();
  });
});
