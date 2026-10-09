import { currentBusinessDay, isOpenAt, timeToMinutes, toLocalTime } from '@app/shared';
import { DEMO_HOURS, OPEN_MARGIN_MINUTES, demoHoursAround } from './hours.js';

const TZ = 'America/Sao_Paulo';
const at = (iso: string) => new Date(iso);
const openAt = (hours: ReturnType<typeof demoHoursAround>, date: Date) => {
  const { weekday, minutes } = toLocalTime(date, TZ);
  return isOpenAt(hours, weekday, minutes);
};

describe('demoHoursAround (seed hours relative to the current moment)', () => {
  it('keeps the weekly hours when the unit is open with time to spare', () => {
    // Wednesday 12:00: lunch until 15:00, dinner later the same business day.
    expect(demoHoursAround(DEMO_HOURS, at('2026-10-07T12:00:00-03:00'), TZ)).toEqual(DEMO_HOURS);
  });

  it('Thursday 23:40 (after closing): keeps Thursday open past midnight', () => {
    const now = at('2026-10-08T23:40:00-03:00');
    const hours = demoHoursAround(DEMO_HOURS, now, TZ);
    expect(hours).toContainEqual({ weekday: 4, opensAt: '18:00', closesAt: '02:40' });
    expect(currentBusinessDay(hours, now, TZ).date).toBe('2026-10-08');
  });

  it('every 15 minutes of a week: open now and in the same business day for the margin', () => {
    const start = at('2026-10-04T00:00:00-03:00').getTime(); // a Sunday
    const later = (OPEN_MARGIN_MINUTES - 5) * 60_000;
    for (let t = start; t < start + 7 * 24 * 3_600_000; t += 15 * 60_000) {
      const now = new Date(t);
      const hours = demoHoursAround(DEMO_HOURS, now, TZ);
      const then = new Date(t + later);
      const label = now.toISOString();
      expect(openAt(hours, now), label).toBe(true);
      expect(openAt(hours, then), label).toBe(true);
      expect(currentBusinessDay(hours, then, TZ).date, label).toBe(
        currentBusinessDay(hours, now, TZ).date,
      );
      // Shifts of the same day never overlap.
      for (let weekday = 0; weekday < 7; weekday++) {
        const day = hours
          .filter((h) => h.weekday === weekday)
          .map((h) => {
            const open = timeToMinutes(h.opensAt);
            const close = timeToMinutes(h.closesAt);
            return [open, close <= open ? close + 1440 : close] as const;
          })
          .sort((a, b) => a[0] - b[0]);
        for (let i = 1; i < day.length; i++)
          expect(day[i]![0], label).toBeGreaterThanOrEqual(day[i - 1]![1]);
      }
    }
  });
});
