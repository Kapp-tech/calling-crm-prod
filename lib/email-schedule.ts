import { EmailFrequency } from '@prisma/client';
import { istDayKey } from './ist-time';

/**
 * When a scheduled email is due, in IST.
 *
 * The server runs UTC and the business runs IST, so every decision here is made
 * on the IST wall clock rather than the process clock. Getting this wrong would
 * fire the "9am daily report" at 2:30pm.
 */

/** The IST wall-clock parts of an instant, without pulling in a date library. */
export function istParts(now: Date): {
  dayKey: string;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
} {
  const dayKey = istDayKey(now);
  const [year, month, day] = dayKey.split('-').map(Number);
  const hm = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  const [hour, minute] = hm.split(':').map(Number);
  // The day key is already an IST date, so its weekday is read in UTC —
  // re-applying a timezone here would shift it by a day near midnight.
  const dow = new Date(`${dayKey}T00:00:00.000Z`).getUTCDay(); // 0=Sun
  return { dayKey, year, month, day, hour, minute, weekday: dow === 0 ? 7 : dow };
}

/**
 * The identifier for the period a rule is currently in.
 *
 * Storing this on the rule after a successful send is what makes the scheduler
 * idempotent: the cron can run every five minutes, or catch up after the box
 * was down, and each rule still fires exactly once per period.
 */
export function periodKeyFor(frequency: EmailFrequency, now: Date): string {
  const p = istParts(now);
  if (frequency === 'DAILY') return p.dayKey;
  if (frequency === 'WEEKLY') {
    // Keyed by the Monday the week starts on rather than an ISO week number,
    // which disagrees with itself across year boundaries.
    const monday = new Date(`${p.dayKey}T00:00:00.000Z`);
    monday.setUTCDate(monday.getUTCDate() - (p.weekday - 1));
    return `W${monday.toISOString().slice(0, 10)}`;
  }
  if (frequency === 'MONTHLY') return `${p.year}-${String(p.month).padStart(2, '0')}`;
  return `${p.year}-Q${Math.floor((p.month - 1) / 3) + 1}`;
}

export interface SchedulableRule {
  frequency: EmailFrequency;
  sendHour: number;
  sendMinute: number;
  weekday: number | null;
  dayOfMonth: number | null;
  lastPeriodKey: string | null;
}

/**
 * Whether a rule should fire right now.
 *
 * Deliberately "at or after the scheduled minute", not "exactly at it": a cron
 * that runs every five minutes would otherwise miss a 09:02 rule entirely, and
 * a restart spanning the exact minute would skip the day silently. Combined
 * with the period key, a late run still sends once rather than not at all.
 */
export function isRuleDue(rule: SchedulableRule, now: Date): boolean {
  const p = istParts(now);

  if (rule.frequency === 'WEEKLY' && rule.weekday && p.weekday !== rule.weekday) return false;
  if (
    (rule.frequency === 'MONTHLY' || rule.frequency === 'QUARTERLY') &&
    rule.dayOfMonth &&
    p.day !== rule.dayOfMonth
  ) {
    return false;
  }
  // A quarterly rule only fires in the first month of the quarter.
  if (rule.frequency === 'QUARTERLY' && (p.month - 1) % 3 !== 0) return false;

  const nowMinutes = p.hour * 60 + p.minute;
  const dueMinutes = rule.sendHour * 60 + rule.sendMinute;
  if (nowMinutes < dueMinutes) return false;

  return rule.lastPeriodKey !== periodKeyFor(rule.frequency, now);
}

/** The window a report covers — the period that has just been completed or is running. */
export function reportWindowFor(
  frequency: EmailFrequency,
  now: Date,
): { from: string; to: string; label: string } {
  const p = istParts(now);
  const shift = (dayKey: string, days: number) => {
    const d = new Date(`${dayKey}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  if (frequency === 'DAILY') return { from: p.dayKey, to: p.dayKey, label: `Today, ${p.dayKey}` };
  if (frequency === 'WEEKLY') {
    const monday = shift(p.dayKey, -(p.weekday - 1));
    return { from: monday, to: shift(monday, 6), label: `Week of ${monday}` };
  }
  if (frequency === 'MONTHLY') {
    const first = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
    const last = new Date(Date.UTC(p.year, p.month, 0)).toISOString().slice(0, 10);
    return { from: first, to: last, label: `${first.slice(0, 7)}` };
  }
  const qStart = Math.floor((p.month - 1) / 3) * 3 + 1;
  const first = `${p.year}-${String(qStart).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(p.year, qStart + 2, 0)).toISOString().slice(0, 10);
  return { from: first, to: last, label: `Q${Math.floor((p.month - 1) / 3) + 1} ${p.year}` };
}
