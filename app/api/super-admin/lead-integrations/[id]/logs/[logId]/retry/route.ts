import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { redeliverLog } from '@/lib/integration-redelivery';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

// Re-renders against the CURRENT integration config (not whatever was
// stored on the original failed attempt) and re-sends — this is how a
// mapping bug gets corrected and replayed for a lead that failed earlier.
export async function POST(_req: NextRequest, { params }: { params: { id: string; logId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    // Ownership is checked here; rebuilding and sending is shared with the
    // automatic sweeper (lib/integration-redelivery) so a recording delivery
    // retries the same way whether a human or the cron asked.
    const log = await prisma.leadIntegrationLog.findUnique({ where: { id: params.logId } });
    if (!log || log.integrationId !== params.id) {
      return NextResponse.json({ error: 'Log entry not found' }, { status: 404 });
    }

    const outcome = await redeliverLog(log.id);
    if (!outcome.ok) {
      return NextResponse.json({ error: outcome.reason }, { status: 400 });
    }

    return NextResponse.json(outcome.result);
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id]/logs/[logId]/retry POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
