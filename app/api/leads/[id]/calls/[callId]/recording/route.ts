import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';
import { callsForLead } from '@/lib/call-log-matching';

/**
 * Streams a call recording from the dialer.
 *
 * Proxied rather than linked directly, for three reasons:
 *
 * 1. **It would not play.** The dialer serves recordings as
 *    `application/forcedownload`, which browsers download rather than decode, so
 *    an `<audio>` element pointed straight at it does nothing useful. Re-labelled
 *    here as `audio/mpeg`.
 * 2. **The dialer's URLs are unauthenticated.** Anyone holding one can fetch the
 *    recording of a student's call. Going through the CRM applies the same
 *    `canAccessLead` rule as the rest of the lead's data, and keeps the upstream
 *    URL — which spells out the phone number and campaign in its path — out of
 *    the browser entirely.
 * 3. Range requests are passed through, so the player can seek instead of having
 *    to buffer a whole call from the start.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string; callId: string } },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canAccessLead(session.user, params.id))) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  // The call must belong to the lead named in the path, so a valid call id
  // cannot be used to read a recording attached to a lead the user cannot see.
  // Same membership rule as the list endpoint, or a call visible in the history
  // would 404 the moment its Play button was pressed.
  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { phone: true },
  });
  const call = await prisma.callLog.findFirst({
    where: { AND: [{ id: params.callId }, callsForLead(params.id, lead?.phone ?? null)] },
    select: { recordingUrl: true },
  });
  if (!call?.recordingUrl) {
    return NextResponse.json({ error: 'No recording for this call' }, { status: 404 });
  }

  // Only ever fetch from the dialer's own hosts — a recordingUrl is third-party
  // data, and without this the route would proxy any URL that reached the column.
  let upstream: URL;
  try {
    upstream = new URL(call.recordingUrl);
  } catch {
    return NextResponse.json({ error: 'Recording URL is not valid' }, { status: 502 });
  }
  const allowedHost = upstream.protocol === 'https:' && /(^|\.)elisiontec\.com$/.test(upstream.hostname);
  if (!allowedHost) {
    console.error('[call recording] refused a non-dialer host:', upstream.hostname);
    return NextResponse.json({ error: 'Recording is not hosted on the dialer' }, { status: 502 });
  }

  const range = req.headers.get('range');
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
    // Recordings never change once written, but they are personal data, so this
    // is cached by the browser only and never by a shared proxy.
    headers.set('Cache-Control', 'private, max-age=3600');

    return new NextResponse(res.body, { status: res.status, headers });
  } catch (err) {
    console.error('[call recording] could not reach the dialer:', err);
    return NextResponse.json({ error: 'Could not reach the dialer' }, { status: 502 });
  }
}
