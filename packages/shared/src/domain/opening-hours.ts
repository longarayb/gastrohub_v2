import { timeToMinutes } from '../utils/datetime.js';

/** Opening hours rules without validation code (light for the browser bundles). */

export interface BusinessHour {
  weekday: number;
  opensAt: string;
  closesAt: string;
}

/**
 * Whether the store is open at the given local weekday/minute.
 * Handles intervals crossing midnight (they belong to the weekday they start on).
 */
export function isOpenAt(
  hours: readonly BusinessHour[],
  weekday: number,
  minutes: number,
): boolean {
  const previousWeekday = (weekday + 6) % 7;
  return hours.some((h) => {
    const open = timeToMinutes(h.opensAt);
    const close = timeToMinutes(h.closesAt);
    const crossesMidnight = close < open;
    if (h.weekday === weekday) {
      return crossesMidnight ? minutes >= open : minutes >= open && minutes < close;
    }
    if (crossesMidnight && h.weekday === previousWeekday) {
      return minutes < close;
    }
    return false;
  });
}
