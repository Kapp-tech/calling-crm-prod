import { NextResponse } from 'next/server';

/**
 * Streams a dialer recording back to the browser.
 *
 * The access rule differs per caller — a lead's call history checks
 * `canAccessLead`, Call Analysis checks VIEW_REPORTS — but everything after
 * that decision is identical, and the three reasons this is proxied at all
 * rather than linked hold for every caller:
 *
 * 1. **It would not play.** The dialer serves recordings as
 *    `application/forcedownload`, which browsers download rather than decode.
 *    Re-labelled here as `audio/mpeg`.
 * 2. **The dialer's URLs are unauthenticated.** Anyone holding one can fetch a
 *    student's call. Proxying keeps the upstream URL — which spells out the
 *    phone number and campaign in its path — out of the browser entirely.
 * 3. Range requests pass through, so the player can seek instead of buffering
 *    a whole call from the start.
 *
 * Callers must authorise first; this function assumes that has happened.
 */
export async function streamRecording(recordingUrl: string, range: string | null) {
  // Only ever fetch from the dialer's own hosts — a recordingUrl is
  // third-party data, and without this we would proxy any URL that reached
  // the column.
  let upstream: URL;
  try {
    upstream = new URL(recordingUrl);
  } catch {
    return NextResponse.json({ error: 'Recording URL is not valid' }, { status: 502 });
  }
  const allowedHost =
    upstream.protocol === 'https:' && /(^|\.)elisiontec\.com$/.test(upstream.hostname);
  if (!allowedHost) {
    console.error('[call recording] refused a non-dialer host:', upstream.hostname);
    return NextResponse.json({ error: 'Recording is not hosted on the dialer' }, { status: 502 });
  }

  try {
    const res = await fetch(upstream, {
      headers: range ? { Range: range } : {},
      cache: 'no-store',
    });
    if (!res.ok && res.status !== 206) {
      return NextResponse.json(
        { error: `The dialer returned HTTP ${res.status} for this recording` },
        { status: 502 },
      );
    }

    const headers = new Headers();
    // Deliberately not the upstream content type — see the note above.
    headers.set('Content-Type', 'audio/mpeg');
    headers.set('Accept-Ranges', 'bytes');
    for (const h of ['content-length', 'content-range'] as const) {
      const v = res.headers.get(h);
      if (v) headers.set(h, v);
    }
    // Recordings never change once written, but they are personal data, so
    // this is cached by the browser only and never by a shared proxy.
    headers.set('Cache-Control', 'private, max-age=3600');

    return new NextResponse(res.body, { status: res.status, headers });
  } catch (err) {
    console.error('[call recording] could not reach the dialer:', err);
    return NextResponse.json({ error: 'Could not reach the dialer' }, { status: 502 });
  }
}
