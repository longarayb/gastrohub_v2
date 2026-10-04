import { isOpenAt, type BusinessHour } from '../stores/schemas.js';
import {
  DEFAULT_TIMEZONE,
  addDaysToDate,
  timeToMinutes,
  toLocalTime,
  weekdayOfDate,
  zonedTimeToInstant,
} from '../utils/datetime.js';

/**
 * End of the store's current business day.
 *
 * A business day is the set of shifts that START on a given weekday; shifts that cross
 * midnight (18:00–02:00) end on the next calendar day. The result is the end of the
 * earliest business day that has not ended yet:
 *  - during a shift (including after midnight of an overnight shift) → end of that day's last shift;
 *  - before opening → end of today's last shift;
 *  - after closing → end of the next business day with shifts.
 * Without opening hours, falls back to the next local midnight.
 */
export function endOfBusinessDay(
  hours: readonly BusinessHour[],
  now: Date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): Date {
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
      if (end > now.getTime()) return new Date(end);
    }
  }

  return zonedTimeToInstant(addDaysToDate(today, 1), 0, timeZone);
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
