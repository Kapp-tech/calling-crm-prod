import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';
import { callsForLead } from '@/lib/call-log-matching';
import { streamRecording } from '@/lib/recording-proxy';

/**
 * Streams a call recording from the dialer, for a call in a lead's history.
 *
 * Access follows the lead: the same `canAccessLead` rule as the rest of the
 * lead's data. See lib/recording-proxy.ts for why this is proxied rather than
 * linked.
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

  return streamRecording(call.recordingUrl, req.headers.get('range'));
}
