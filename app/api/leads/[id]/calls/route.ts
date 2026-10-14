import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';
import { callsForLead } from '@/lib/call-log-matching';

/**
 * The dialer's call history for one lead.
 *
 * Rows are written only by the DialShree post-call webhook, so this is a
 * read-only view of what actually happened on the phone — talk time, ring time
 * and the recording — as opposed to the feedback a counsellor typed afterwards.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    if (!(await canAccessLead(session.user, params.id))) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    // The lead's own number is needed to pick up calls the webhook could not
    // match at the time — see callsForLead.
    const lead = await prisma.lead.findUnique({
      where: { id: params.id },
      select: { phone: true },
    });

    const calls = await prisma.callLog.findMany({
      where: callsForLead(params.id, lead?.phone ?? null),
      // Newest first; a row with no start time from the dialer falls back to
      // when we received it so it still sorts sensibly instead of last.
      orderBy: [{ startedAt: 'desc' }, { receivedAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        startedAt: true,
        endedAt: true,
        durationSeconds: true,
        talkTimeSeconds: true,
        ringTimeSeconds: true,
        callType: true,
        callStatus: true,
        connected: true,
        calledCount: true,
        recordingUrl: true,
        agentFullName: true,
        agentSeat: true,
        receivedAt: true,
        agent: { select: { id: true, name: true } },
        // Whatever the call-analytics tool returned for this recording. Null
        // until it calls back, which is the normal state for a fresh call.
        analysis: {
          select: { score: true, maxScore: true, summary: true, feedback: true, metrics: true, receivedAt: true },
        },
      },
    });

    // The upstream URL is never sent to the browser: it is unauthenticated and
    // spells out the phone number and campaign in its path. The client asks the
    // proxy route for audio and only needs to know whether one exists.
    return NextResponse.json(
      calls.map(({ recordingUrl, ...c }) => ({ ...c, hasRecording: Boolean(recordingUrl) })),
    );
  } catch (err) {
    console.error('[leads/[id]/calls GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
