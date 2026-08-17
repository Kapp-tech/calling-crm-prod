// Server-only client for the DialShree (Elision) dialer.
//
// Three upstream endpoints are involved:
//   POST /api/login           -> { access_token, token_type }
//   POST /api/manual-dial     -> bridges a call between an agent and a number
//   POST /api/external-hangup -> drops the agent's current call
//
// All of them take multipart form fields, not JSON.
//
// This module must never be imported from a client component: it holds the
// dialer credentials and the bearer token, and neither may reach the browser.
// The UI talks to /api/dialer/* instead, which is where the CRM's own auth and
// lead-access checks live.

const LOGIN_URL = 'https://dialer8.elisiontec.com/api/login';
const DIAL_URL = 'https://dialer8.elisiontec.com/api/manual-dial';
const HANGUP_URL = 'https://dialer8.elisiontec.com/api/external-hangup';

// The upstream is a phone system — a hung request would leave the agent staring
// at a spinner while the call may or may not be ringing. Fail fast instead.
const FETCH_TIMEOUT_MS = 15_000;

// The provider says the token is refreshed every half hour but returns no
// `expires_in`, so we cannot read the real expiry. Re-mint well inside that
// window rather than waiting to be rejected mid-call. A 401 also triggers a
// forced re-login (see `withToken`), so an early expiry is still recovered.
const TOKEN_TTL_MS = 20 * 60 * 1000;

export class DialshreeError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown
  ) {
    super(message);
    this.name = 'DialshreeError';
  }
}

function credentials(): { user: string; password: string } {
  const user = process.env.DIALSHREE_USER;
  const password = process.env.DIALSHREE_PASSWORD;
  if (!user || !password) {
    throw new DialshreeError(
      'Dialer is not configured on this server (DIALSHREE_USER / DIALSHREE_PASSWORD missing).',
      503
    );
  }
  return { user, password };
}

export function isDialshreeConfigured(): boolean {
  return Boolean(process.env.DIALSHREE_USER && process.env.DIALSHREE_PASSWORD);
}

async function postForm(url: string, fields: Record<string, string>, token?: string) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: form,
      signal: controller.signal,
      cache: 'no-store',
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new DialshreeError(`Dialer did not respond within ${FETCH_TIMEOUT_MS / 1000}s.`, 504);
    }
    throw new DialshreeError('Could not reach the dialer.', 502, err);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Token cache ──────────────────────────────────────────────────────────────
// Module-level, so it is per server process. The app runs as a single pm2
// process today; if it is ever clustered, each worker simply mints its own
// token, which the provider allows.
let cached: { token: string; expiresAt: number } | null = null;
// Concurrent diallers must not each fire a login: share one in-flight request.
let inFlight: Promise<string> | null = null;

async function login(): Promise<string> {
  const { user, password } = credentials();
  const res = await postForm(LOGIN_URL, { user, password });
  const body = await res.json().catch(() => null);

  if (!res.ok || !body?.access_token) {
    throw new DialshreeError('Dialer login failed — check DIALSHREE_USER / DIALSHREE_PASSWORD.', 502, body);
  }
  cached = { token: body.access_token as string, expiresAt: Date.now() + TOKEN_TTL_MS };
  return cached.token;
}

async function getToken(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt > Date.now()) return cached.token;
  if (force) cached = null;
  if (!inFlight) {
    inFlight = login().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * Run an authenticated call, re-minting the token once if the dialer rejects it.
 * The provider rotates tokens on its own schedule, so a 401 is an expected
 * outcome rather than an error worth surfacing to the agent.
 */
async function withToken(fn: (token: string) => Promise<Response>): Promise<Response> {
  let res = await fn(await getToken());
  if (res.status === 401 || res.status === 403) {
    res = await fn(await getToken(true));
  }
  return res;
}

async function parse(res: Response, action: string) {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && (body.message || body.error)) ||
      `Dialer rejected the ${action} request (HTTP ${res.status}).`;
    throw new DialshreeError(String(message), res.status === 401 ? 502 : res.status, body);
  }
  return body;
}

/**
 * Place a click-to-call: the dialer rings `agentUser`'s softphone and bridges
 * it to `phone`.
 *
 * `phone` must be the subscriber number without the country code — the country
 * code travels separately in `phone_code`.
 */
export async function manualDial(opts: {
  phone: string;
  agentUser: string;
  phoneCode?: string;
}): Promise<unknown> {
  const res = await withToken((token) =>
    postForm(
      DIAL_URL,
      {
        value: opts.phone,
        phone_code: opts.phoneCode ?? process.env.DIALSHREE_PHONE_CODE ?? '91',
        search: 'YES',
        preview: 'NO',
        focus: 'YES',
        agent_user: opts.agentUser,
      },
      token
    )
  );
  return parse(res, 'dial');
}

/**
 * Hang up the agent's live call.
 *
 * `value` is passed through from the caller. The provider's example sends "1",
 * and it is not documented whether that is a constant or a call/channel handle
 * returned by manual-dial — so the dial response is preserved end-to-end (see
 * /api/dialer/call) and echoed back here when the client has one, defaulting to
 * "1" otherwise. If it turns out to be a handle, only this default changes.
 */
export async function externalHangup(opts: {
  agentUser: string;
  value?: string;
}): Promise<unknown> {
  const res = await withToken((token) =>
    postForm(
      HANGUP_URL,
      {
        value: opts.value ?? '1',
        agent_user: opts.agentUser,
      },
      token
    )
  );
  return parse(res, 'hangup');
}

/** Test helper — drops the cached token so the next call re-logs in. */
export function __resetDialshreeToken() {
  cached = null;
  inFlight = null;
}
