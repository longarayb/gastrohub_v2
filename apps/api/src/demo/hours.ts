import {
  type BusinessHour,
  DEFAULT_TIMEZONE,
  minutesToTime,
  timeToMinutes,
  toLocalTime,
} from '@app/shared';

/** Opening hours of the demo unit. Fri/Sat night shifts cross midnight (they belong to the
 * day they start). The 90-day history is generated with these. */
export const DEMO_HOURS: BusinessHour[] = [
  ...[2, 3, 4].flatMap((weekday) => [
    { weekday, opensAt: '11:00', closesAt: '15:00' },
    { weekday, opensAt: '18:00', closesAt: '23:30' },
  ]),
  ...[5, 6].flatMap((weekday) => [
    { weekday, opensAt: '11:00', closesAt: '15:00' },
    { weekday, opensAt: '18:00', closesAt: '02:00' },
  ]),
  { weekday: 0, opensAt: '11:00', closesAt: '16:00' },
  { weekday: 1, opensAt: '11:00', closesAt: '15:00' },
];

/** How long the unit stays open (and in the same business day) after the seed runs. */
export const OPEN_MARGIN_MINUTES = 180;

interface Instance {
  hour: BusinessHour;
  /** Minutes relative to today's local midnight (yesterday's shifts are negative). */
  start: number;
  end: number;
  /** -1440 for a shift of yesterday, 0 for today. */
  dayOffset: number;
}

/**
 * Hours saved for the demo unit (D039): the weekly hours above, adjusted so that at `now` the
 * unit is OPEN and stays open, in the SAME business day, for at least `OPEN_MARGIN_MINUTES`.
 * Walkthroughs and demos then behave the same at any hour (late at night the business day
 * would otherwise move to the next day in the middle of a run). Only the shift around `now`
 * changes: a closing time moves later, an opening time earlier, or a short shift is added.
 */
export function demoHoursAround(
  base: readonly BusinessHour[],
  now: Date,
  timeZone = DEFAULT_TIMEZONE,
): BusinessHour[] {
  const hours = base.map((h) => ({ ...h }));
  const { weekday, minutes } = toLocalTime(now, timeZone);
  const yesterday = (weekday + 6) % 7;
  const target = minutes + OPEN_MARGIN_MINUTES;

  const instancesOf = (hour: BusinessHour): Instance[] => {
    const open = timeToMinutes(hour.opensAt);
    let close = timeToMinutes(hour.closesAt);
    if (close <= open) close += 1440;
    const list: Instance[] = [];
    if (hour.weekday === weekday) list.push({ hour, start: open, end: close, dayOffset: 0 });
    if (hour.weekday === yesterday) {
      list.push({ hour, start: open - 1440, end: close - 1440, dayOffset: -1440 });
    }
    return list;
  };
  const instances = () => hours.flatMap(instancesOf);
  const setClose = (i: Instance, at: number) => {
    i.hour.closesAt = minutesToTime((at - i.dayOffset) % 1440);
    i.end = at;
  };

  let current: Instance | undefined = instances().find(
    (i) => i.start <= minutes && minutes < i.end,
  );
  if (!current) {
    const all = instances();
    const prev = all.filter((i) => i.end <= minutes).sort((a, b) => b.end - a.end)[0];
    const next = all.filter((i) => i.start > minutes).sort((a, b) => a.start - b.start)[0];
    if (prev && prev.end >= minutes - 60) {
      // Just closed: keep the last shift open.
      setClose(prev, minutes + 1);
      current = prev;
    } else if (next && next.start <= minutes + 60) {
      // About to open: open now (a shift of today, so start >= 0).
      next.hour.opensAt = minutesToTime(minutes);
      next.start = minutes;
      current = next;
    } else {
      const hour: BusinessHour = {
        weekday,
        opensAt: minutesToTime(Math.max(minutes - 60, prev?.end ?? 0, 0)),
        closesAt: minutesToTime((minutes + 1) % 1440),
      };
      hours.push(hour);
      current = instancesOf(hour).find((i) => i.dayOffset === 0)!;
    }
  }

  // Stay open until the target: join the next shift if it starts before it, else close later.
  let open: Instance = current;
  while (open.end < target) {
    const end = open.end;
    const next: Instance | undefined = instances()
      .filter((i) => i.start >= end && i.start < target)
      .sort((a, b) => a.start - b.start)[0];
    if (!next) {
      setClose(open, target);
      break;
    }
    setClose(open, next.start);
    open = next;
  }
  return hours;
}
