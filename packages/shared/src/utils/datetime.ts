/** Date/time helpers pinned to the Brazilian business timezone. */

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

function getParts(date: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** Business date ("YYYY-MM-DD") of an instant in the given timezone. */
export function toBusinessDate(date: Date = new Date(), timeZone = DEFAULT_TIMEZONE): string {
  const p = getParts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Local weekday (0 = Sunday) and minutes since midnight of an instant in the timezone. */
export function toLocalTime(
  date: Date = new Date(),
  timeZone = DEFAULT_TIMEZONE,
): { weekday: number; minutes: number; businessDate: string } {
  const p = getParts(date, timeZone);
  return {
    weekday: WEEKDAYS.indexOf(p.weekday as (typeof WEEKDAYS)[number]),
    minutes: Number(p.hour) * 60 + Number(p.minute),
    businessDate: `${p.year}-${p.month}-${p.day}`,
  };
}

/** "18:30" -> 1110 */
export function timeToMinutes(time: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!match) throw new RangeError(`Invalid time: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 1110 -> "18:30" */
export function minutesToTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DEFAULT_TIMEZONE,
  dateStyle: 'short',
  timeStyle: 'short',
});
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DEFAULT_TIMEZONE,
  dateStyle: 'short',
});
const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: DEFAULT_TIMEZONE,
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDateTime = (d: Date | string): string =>
  dateTimeFormatter.format(new Date(d)).replace(',', '');
export const formatDate = (d: Date | string): string => dateFormatter.format(new Date(d));
export const formatTime = (d: Date | string): string => timeFormatter.format(new Date(d));

/** Elapsed whole minutes between two instants. */
export function elapsedMinutes(from: Date | string, to: Date = new Date()): number {
  return Math.max(0, Math.floor((to.getTime() - new Date(from).getTime()) / 60_000));
}
