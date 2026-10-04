import { isOpenAt, type BusinessHour } from '../stores/schemas.js';
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
