import { type BusinessHour, isOpenAt } from './opening-hours.js';
import {
  DEFAULT_TIMEZONE,
  addDaysToDate,
  timeToMinutes,
  toLocalTime,
  weekdayOfDate,
  zonedTimeToInstant,
} from '../utils/datetime.js';

export interface BusinessDay {
  /** Calendar date ("YYYY-MM-DD") on which the business day starts. */
  date: string;
  /** Instant when the business day ends (end of its last shift). */
  endsAt: Date;
}

/**
 * The store's current business day.
 *
 * A business day is the set of shifts that START on a given weekday; shifts that cross
 * midnight (18:00–02:00) end on the next calendar day. The result is the earliest
 * business day that has not ended yet:
 *  - during a shift (including after midnight of an overnight shift) → that day;
 *  - before opening → today;
 *  - after closing → the next day with shifts.
 * Without opening hours, the business day is the local calendar day.
 *
 * Used for "Acabou" pauses (`endsAt`) and daily order numbering (`date`), so both
 * always agree on which day an instant belongs to.
 */
export function currentBusinessDay(
  hours: readonly BusinessHour[],
  now: Date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): BusinessDay {
  const today = toLocalTime(now, timeZone).businessDate;

  if (hours.length > 0) {
    // Yesterday first: its overnight shift may still be running.
    for (let offset = -1; offset <= 7; offset++) {
      const date = addDaysToDate(today, offset);
      const shifts = hours.filter((h) => h.weekday === weekdayOfDate(date));
      if (shifts.length === 0) continue;

      const end = Math.max(
        ...shifts.map((h) => {
          const open = timeToMinutes(h.opensAt);
          const close = timeToMinutes(h.closesAt);
          const endMinutes = close <= open ? close + 1440 : close;
          return zonedTimeToInstant(date, endMinutes, timeZone).getTime();
        }),
      );
      if (end > now.getTime()) return { date, endsAt: new Date(end) };
    }
  }

  return { date: today, endsAt: zonedTimeToInstant(addDaysToDate(today, 1), 0, timeZone) };
}

/** End of the store's current business day (see `currentBusinessDay`). */
export function endOfBusinessDay(
  hours: readonly BusinessHour[],
  now: Date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): Date {
  return currentBusinessDay(hours, now, timeZone).endsAt;
}

/**
 * Whether `now` falls inside the schedule windows. An empty schedule means "always".
 * Windows may cross midnight, with the same rules as the opening hours.
 */
export function isWithinSchedule(
  schedule: readonly BusinessHour[],
  now: Date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): boolean {
  if (schedule.length === 0) return true;
  const { weekday, minutes } = toLocalTime(now, timeZone);
  return isOpenAt(schedule, weekday, minutes);
}

/**
 * Business date of many instants (reports): same rule as `currentBusinessDay`, with the end
 * of each calendar day computed once.
 */
function dayEnds(hours: readonly BusinessHour[], timeZone: string) {
  const ends = new Map<string, number | null>();
  return (date: string): number | null => {
    if (ends.has(date)) return ends.get(date)!;
    const shifts = hours.filter((h) => h.weekday === weekdayOfDate(date));
    const end = shifts.length
      ? Math.max(
          ...shifts.map((h) => {
            const open = timeToMinutes(h.opensAt);
            const close = timeToMinutes(h.closesAt);
            return zonedTimeToInstant(
              date,
              close <= open ? close + 1440 : close,
              timeZone,
            ).getTime();
          }),
        )
      : null;
    ends.set(date, end);
    return end;
  };
}

export function businessDateResolver(
  hours: readonly BusinessHour[],
  timeZone = DEFAULT_TIMEZONE,
): (at: Date) => string {
  const endOf = dayEnds(hours, timeZone);
  return (at) => {
    const today = toLocalTime(at, timeZone).businessDate;
    if (!hours.length) return today;
    for (let offset = -1; offset <= 7; offset++) {
      const date = addDaysToDate(today, offset);
      const end = endOf(date);
      if (end !== null && end > at.getTime()) return date;
    }
    return today;
  };
}

/**
 * Instants of a period of business days, for filtering in the database: an instant belongs to
 * the period when `gt < instant <= lte` (same rule as `businessDateResolver`; closed days
 * belong to the next open one). Null when the period has no open day.
 */
export function businessDayWindow(
  from: string,
  to: string,
  hours: readonly BusinessHour[],
  timeZone = DEFAULT_TIMEZONE,
): { gt: Date; lte: Date } | null {
  if (!hours.length) {
    return {
      gt: new Date(zonedTimeToInstant(from, 0, timeZone).getTime() - 1),
      lte: new Date(zonedTimeToInstant(addDaysToDate(to, 1), 0, timeZone).getTime() - 1),
    };
  }
  const endOf = dayEnds(hours, timeZone);
  const lastOpen = (date: string, limit: number): string | null => {
    for (let i = 0; i < limit; i++) {
      const d = addDaysToDate(date, -i);
      if (endOf(d) !== null) return d;
    }
    return null;
  };
  const last = lastOpen(to, 400);
  if (!last || last < from) return null;
  const before = lastOpen(addDaysToDate(from, -1), 8);
  const start = before ? endOf(before)! : zonedTimeToInstant(from, 0, timeZone).getTime() - 1;
  return { gt: new Date(start), lte: new Date(endOf(last)!) };
}
