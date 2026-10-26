import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { streamRecording } from '@/lib/recording-proxy';
import { resolveCallAnalysisScope } from '@/lib/call-analysis-scope';

/**
 * Streams the recording for a scored call.
 *
 * A separate route from the lead-scoped one because roughly half of all calls
 * match no lead at all — there is no lead id to put in the path, and the
 * analyser scores those calls like any other.
 *
 * Access is the same scope as the Call Analysis list, applied to this one
 * row: an agent can only fetch a recording of a call the dialer attributed to
 * them. The id must also name a call that has actually been scored, so this
 * cannot be used to reach an arbitrary recording. Both conditions are checked
 * in the query rather than after it — a `findUnique` on the id followed by a
 * comparison is the shape that tends to grow a hole later.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scope = await resolveCallAnalysisScope(session.user);
  if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const analysis = await prisma.callAnalysis.findFirst({
    where: { AND: [{ callLogId: params.id }, scope.where] },
    select: { callLog: { select: { recordingUrl: true } } },
  });
  // Deliberately the same 404 whether the call is out of scope or simply has
  // no recording — a distinct response would confirm that a call exists.
  if (!analysis?.callLog?.recordingUrl) {
    return NextResponse.json({ error: 'No recording for this call' }, { status: 404 });
  }

  return streamRecording(analysis.callLog.recordingUrl, req.headers.get('range'));
}
