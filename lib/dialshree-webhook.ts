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
  /** The dialer's own verdict, e.g. "CONNECTED" / "NOT CONNECTED". */
  callStatus: string | null;
  /** Whether the two parties actually spoke. See `connectedFrom`. */
  connected: boolean | null;
  termReason: string | null;
  dispositionDescription: string | null;
  dialerLeadId: string | null;
  phoneCode: string | null;
  phoneNumber: string;
  /** Last 10 digits — what Lead.phone stores. */
  phoneKey: string;
  agentSeat: string | null;
  /** `security_phrase` verbatim — the dialer's own tag on the call. */
  securityPhrase: string | null;
  /**
   * True when the dialer says the caller hung up before an agent picked up:
   * a missed call. DialShree signals it with `term_reason: "ABANDON"`.
   */
  missed: boolean;
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
/**
 * The agent seat inside a `sticky<dialshreeId>` tag — "sticky100098" -> "100098".
 *
 * Read from `security_phrase` first and `campaign` second. On production
 * `security_phrase` is usually empty and `campaign` carries it, so taking
 * whichever is present is what makes the attribution work at all.
 *
 * Anything not matching `sticky<digits>` is ignored rather than guessed at:
 * outbound calls carry a real campaign name here ("INDO INTERNET PR…"), and
 * some inbound ones carry "INDO_INTERNET_IN". Neither is a seat id.
 */
export function stickySeat(d: Record<string, unknown>): string | null {
  for (const key of ['security_phrase', 'campaign']) {
    const raw = typeof d[key] === 'string' ? (d[key] as string).trim() : '';
    const m = /^sticky(\d+)$/i.exec(raw);
    if (m) return m[1];
  }
  return null;
}

export function phoneKeyOf(value: unknown): string {
  const digits = (str(value) ?? '').replace(/\D+/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export class DialerWebhookError extends Error {}

/**
 * The call fields, whether they arrived nested under `postdata` or at the top
 * level. The provider's documented sample nests them; what they actually send
 * is flat.
 */
function postdataOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') throw new DialerWebhookError('Body must be a JSON object');
  const b = body as Record<string, unknown>;
  const inner = b.postdata;
  if (inner && typeof inner === 'object') return inner as Record<string, unknown>;
  return b;
}

/**
 * `dynamic_data` is documented as an object holding `uniqueid` and `user`, but
 * the live feed sends it as an empty string and puts both at the top level
 * instead. Look in both places rather than trusting either: without this the
 * call has no dialer id (so retries duplicate) and no seat (so it is attributed
 * to nobody).
 */
function fromEitherLevel(d: Record<string, unknown>, key: string): unknown {
  const dynamic = d.dynamic_data;
  if (dynamic && typeof dynamic === 'object' && key in (dynamic as Record<string, unknown>)) {
    return (dynamic as Record<string, unknown>)[key];
  }
  return d[key];
}

/**
 * Whether the parties actually spoke.
 *
 * The dialer's own `call_status` is authoritative and is used when present — it
 * has been seen to report NOT CONNECTED on a call with seven seconds of "talk
 * time", so inferring from the clock alone would over-count. Talk time is only
 * the fallback for a payload without a status.
 */
export function connectedFrom(callStatus: string | null, talkTimeSeconds: number | null): boolean | null {
  if (callStatus) {
    const s = callStatus.trim().toUpperCase();
    if (s === 'CONNECTED') return true;
    if (s === 'NOT CONNECTED' || s === 'NOTCONNECTED') return false;
  }
  if (talkTimeSeconds === null) return null;
  return talkTimeSeconds > 0;
}

export function parseDialerCall(body: unknown): DialerCallFacts {
  const d = postdataOf(body);

  const phoneNumber = str(d.phone_number);
  if (!phoneNumber) throw new DialerWebhookError('phone_number is required');
  const phoneKey = phoneKeyOf(phoneNumber);
  if (phoneKey.length < 10) {
    throw new DialerWebhookError(`phone_number "${phoneNumber}" is not a full 10-digit number`);
  }

  const talkTimeRaw = str(d.talk_time);
  const ringTimeRaw = str(d.ring_time);
  const talkTimeSeconds = parseClockToSeconds(talkTimeRaw);
  const callStatus = str(d.call_status);

  return {
    uniqueId: str(fromEitherLevel(d, 'uniqueid')),
    callStatus,
    connected: connectedFrom(callStatus, talkTimeSeconds),
    termReason: str(d.term_reason),
    dispositionDescription: str(d.disposition_description),
    dialerLeadId: str(d.lead_id),
    // The provider's sample has a smart quote here ("91) — str() trims but a
    // stray quote would survive, so non-digits are stripped.
    phoneCode: str((str(d.phone_code) ?? '').replace(/\D+/g, '')),
    phoneNumber,
    phoneKey,
    /**
     * Sticky FIRST, `user` second — not the other way round.
     *
     * On an outbound call `user` is the real seat ("100098") and the campaign is
     * the dialing campaign ("INDO INTERNET PR…"), which never matches the sticky
     * pattern, so `user` is used. On an inbound call the lead abandoned, `user`
     * is the trunk — literally "VDCL" on production, not an agent at all — and
     * the seat the lead was sticky to is in the campaign as `sticky100096`.
     *
     * Treating sticky as a mere fallback attributed nothing: `user` was present
     * on every one of those rows, just useless. Sticky only ever appears where
     * it is the right answer, so it leads.
     */
    agentSeat: stickySeat(d) ?? str(fromEitherLevel(d, 'user')),
    securityPhrase: str(d.security_phrase),
    missed: (str(d.term_reason) ?? '').toUpperCase() === 'ABANDON',
    agentFullName: str(d.agent_full_name),
    agentEmail: str(d.agent_email),
    callType: str(d.call_type),
    campaign: str(d.campaign),
    urlType: str(d.url_type),
    startedAt: parseDialerTimestamp(d.call_start_time),
    endedAt: parseDialerTimestamp(d.call_end_time),
    durationSeconds: int(d.call_duration),
    talkTimeSeconds,
    ringTimeSeconds: parseClockToSeconds(ringTimeRaw),
    talkTimeRaw,
    ringTimeRaw,
    calledCount: int(d.called_count),
    lastLocalCallAt: parseDialerTimestamp(d.last_local_call_time),
    recordingUrl: str(d.recording_url),
  };
}
