import { istWallClockToInstant } from './ist-time';

/**
 * Normalising the DialShree post-call webhook body.
 *
 * Kept apart from the route so it can be exercised directly: every value here
 * comes from a third party and the provider's own sample already contains a
 * smart quote, a trailing comma, and a call whose ring time exceeds its
 * duration. Nothing is trusted, nothing is required except a phone number, and
 * anything unrecognised still reaches the database in `payload`.
 */

export interface DialerCallFacts {
  uniqueId: string | null;
  phoneCode: string | null;
  phoneNumber: string;
  /** Last 10 digits — what Lead.phone stores. */
  phoneKey: string;
  agentSeat: string | null;
  agentFullName: string | null;
  agentEmail: string | null;
  callType: string | null;
  campaign: string | null;
  urlType: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  talkTimeSeconds: number | null;
  ringTimeSeconds: number | null;
  talkTimeRaw: string | null;
  ringTimeRaw: string | null;
  calledCount: number | null;
  lastLocalCallAt: Date | null;
  recordingUrl: string | null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function int(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * "00:12" → 12, "01:05:03" → 3903.
 *
 * The dialer sends MM:SS for short calls and HH:MM:SS for long ones, with no
 * flag distinguishing them, so the parts are read from the right — seconds
 * always last. A plain integer is accepted as seconds.
 */
export function parseClockToSeconds(value: unknown): number | null {
  const s = str(value);
  if (s === null) return null;
  if (/^\d+$/.test(s)) return Number(s);

  const parts = s.split(':');
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p.trim()))) return null;

  const nums = parts.map((p) => Number(p.trim())).reverse(); // [ss, mm, hh?]
  return (nums[0] ?? 0) + (nums[1] ?? 0) * 60 + (nums[2] ?? 0) * 3600;
}

/**
 * The dialer's timestamps carry no timezone and are Indian wall-clock.
 *
 * Two shapes appear in one payload — "2026-07-13T12:18:53" and
 * "2026-07-13 02:18:36" — and the space-separated form would otherwise fall
 * through to `new Date()`, which reads it in the *server process's* zone. That
 * silently shifts every such timestamp by 5:30 on a UTC box while looking
 * correct on an IST laptop, so the separator is normalised first and the value
 * is then anchored to IST explicitly.
 */
export function parseDialerTimestamp(value: unknown): Date | null {
  const s = str(value);
  if (s === null) return null;
  // Already zoned (trailing Z or ±HH:MM) — unambiguous, leave it alone.
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  const normalised = s.replace(' ', 'T').replace(/\.\d+$/, '');
  return istWallClockToInstant(normalised);
}

/**
 * Reduces a phone number to the last 10 digits.
 *
 * The dialer sends the subscriber number and the country code separately, but
 * has been seen to include the code inline too. Leads are stored as 10 digits,
 * so both forms have to collapse to the same key or a real call would look like
 * it belonged to no lead.
 */
export function phoneKeyOf(value: unknown): string {
  const digits = (str(value) ?? '').replace(/\D+/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export class DialerWebhookError extends Error {}

/** The `postdata` object, whether it arrived nested or at the top level. */
function postdataOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new DialerWebhookError('Body must be a JSON object');
  const b = body as Record<string, unknown>;
  const inner = b.postdata;
  // Tolerating a flat body costs nothing and saves a failed integration if the
  // provider ever drops the wrapper.
  if (inner && typeof inner === 'object') return inner as Record<string, unknown>;
  return b;
}

export function parseDialerCall(body: unknown): DialerCallFacts {
  const d = postdataOf(body);
  const dynamic = (d.dynamic_data && typeof d.dynamic_data === 'object'
    ? (d.dynamic_data as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  const phoneNumber = str(d.phone_number);
  if (!phoneNumber) throw new DialerWebhookError('phone_number is required');
  const phoneKey = phoneKeyOf(phoneNumber);
  if (phoneKey.length < 10) {
    throw new DialerWebhookError(`phone_number "${phoneNumber}" is not a full 10-digit number`);
  }

  const talkTimeRaw = str(d.talk_time);
  const ringTimeRaw = str(d.ring_time);

  return {
    uniqueId: str(dynamic.uniqueid),
    // The provider's sample has a smart quote here ("91) — str() trims but a
    // stray quote would survive, so non-digits are stripped.
    phoneCode: str((str(d.phone_code) ?? '').replace(/\D+/g, '')),
    phoneNumber,
    phoneKey,
    agentSeat: str(dynamic.user),
    agentFullName: str(d.agent_full_name),
    agentEmail: str(d.agent_email),
    callType: str(d.call_type),
    campaign: str(d.campaign),
    urlType: str(d.url_type),
    startedAt: parseDialerTimestamp(d.call_start_time),
    endedAt: parseDialerTimestamp(d.call_end_time),
    durationSeconds: int(d.call_duration),
    talkTimeSeconds: parseClockToSeconds(talkTimeRaw),
    ringTimeSeconds: parseClockToSeconds(ringTimeRaw),
    talkTimeRaw,
    ringTimeRaw,
    calledCount: int(d.called_count),
    lastLocalCallAt: parseDialerTimestamp(d.last_local_call_time),
    recordingUrl: str(d.recording_url),
  };
}
