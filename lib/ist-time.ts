// Scheduled calls are always expressed in India Standard Time, regardless of
// where the Node process or the viewer's browser happens to be. Same posture as
// lib/attendance.ts, which already pins attendance bookkeeping to Asia/Kolkata.
//
// Why this file exists: <input type="datetime-local"> yields an offset-less
// wall-clock string ("2026-08-10T15:30"). Per the ECMAScript spec, a date-TIME
// form with no offset is parsed as the *host's* local time — so `new Date(str)`
// meant 15:30 IST on a developer's Mac but 15:30 UTC on the production server,
// storing an instant 5h30m later than the agent picked. Converting explicitly
// here removes the host timezone from the equation on both ends.
//
// The offset is hardcoded rather than derived because India has never observed
// daylight saving and IST is a permanent UTC+05:30 — so there is no date for
// which this constant is wrong, and a fixed offset parses unambiguously in
// every JS engine.

export const IST_TIMEZONE = 'Asia/Kolkata';
const IST_UTC_OFFSET = '+05:30';

/** Matches the value a <input type="datetime-local"> produces, with optional seconds. */
const WALL_CLOCK_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/;

/**
 * Converts an IST wall-clock string ("YYYY-MM-DDTHH:mm") into the absolute
 * instant it denotes. Returns null when the input isn't a usable wall clock.
 *
 * An input that already carries a zone (a trailing "Z" or "+05:30") is passed
 * through as-is: it is already unambiguous, so re-interpreting it would corrupt
 * it. That keeps the function safe to apply to values from any client.
 */
export function istWallClockToInstant(value: string): Date | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const match = WALL_CLOCK_RE.exec(trimmed);
  const iso = match
    ? `${match[1]}T${match[2]}${match[3] ?? ':00'}${IST_UTC_OFFSET}`
    : trimmed;

  const date = new Date(iso);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Inverse of istWallClockToInstant — renders an instant as the IST wall-clock
 * string a datetime-local input expects. Used for the picker's `min` bound so
 * the bound is stated in the same frame of reference the input displays.
 */
export function instantToIstWallClock(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  // hour12:false can yield "24" for midnight in some engines; normalise to "00".
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`;
}

/** Date + time in IST, e.g. "10 Aug 2026, 03:30 pm". */
export function formatIstDateTime(value: Date | string): string {
  return new Date(value).toLocaleString('en-IN', {
    timeZone: IST_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/** Time only, in IST, e.g. "03:30 pm". */
export function formatIstTime(value: Date | string): string {
  return new Date(value).toLocaleTimeString('en-IN', {
    timeZone: IST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * The IST calendar day an instant falls on, as "YYYY-MM-DD".
 * Day-bucketing and today/overdue checks must use this rather than the
 * viewer's local getters, or a call lands in the wrong day for anyone whose
 * machine isn't set to IST.
 */
export function istDayKey(value: Date | string): string {
  return instantToIstWallClock(new Date(value)).slice(0, 10);
}

const DAY_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Normalises either a "YYYY-MM-DD" day string or an instant to an IST day key. */
function toIstDayKey(value: string | Date): string {
  if (typeof value === 'string' && DAY_KEY_RE.test(value.trim())) return value.trim();
  return istDayKey(new Date(value));
}

/**
 * First instant of an IST calendar day — the correct lower bound for a
 * date-range query.
 *
 * Note what this replaces: `new Date("2026-08-10")` is specified to parse a
 * DATE-ONLY string as UTC, so it yields 05:30 IST rather than midnight IST and
 * silently drops anything created in the first 5.5 hours of the day. (That form
 * is at least consistent across machines; the `setHours()` upper bound it was
 * usually paired with was not — see istEndOfDay.)
 */
export function istStartOfDay(value: string | Date): Date {
  return new Date(`${toIstDayKey(value)}T00:00:00.000${IST_UTC_OFFSET}`);
}

/**
 * Last instant of an IST calendar day — the correct inclusive upper bound.
 *
 * Replaces `d.setHours(23, 59, 59, 999)`, which mutates in the *host's* zone:
 * correct by luck on an IST developer machine, 5.5 hours too late on a UTC
 * server, and wrong by a different amount anywhere else.
 */
export function istEndOfDay(value: string | Date): Date {
  return new Date(`${toIstDayKey(value)}T23:59:59.999${IST_UTC_OFFSET}`);
}

/** First instant of today, in IST. */
export function istStartOfToday(): Date {
  return istStartOfDay(new Date());
}

/**
 * Shifts an IST day key by whole days, e.g. istShiftDays('2026-08-10', -6).
 * Done via the day's IST midnight instant so it never trips over host-local
 * month/year rollover.
 */
export function istShiftDays(value: string | Date, days: number): string {
  const base = istStartOfDay(value);
  return istDayKey(new Date(base.getTime() + days * 86_400_000));
}

/**
 * Reads a "YYYY-MM-DD" day key back as a Date pinned to UTC midnight, for code
 * that needs the calendar fields (weekday, month) of the day itself rather than
 * an instant on the timeline.
 *
 * Pair it with getUTC* getters or `timeZone: 'UTC'` formatting: the key already
 * *is* the IST calendar date, so reading it in UTC reproduces those fields
 * exactly, whereas local getters would shift them for any non-UTC viewer.
 */
export function dayKeyAsUtcDate(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}
