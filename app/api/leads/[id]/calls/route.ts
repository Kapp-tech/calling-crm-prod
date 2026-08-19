import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';

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

    const calls = await prisma.callLog.findMany({
      where: { leadId: params.id },
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
        talkTimeRaw: true,
        callType: true,
        campaign: true,
        recordingUrl: true,
        agentFullName: true,
        agentSeat: true,
        receivedAt: true,
        agent: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(calls);
  } catch (err) {
    console.error('[leads/[id]/calls GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
