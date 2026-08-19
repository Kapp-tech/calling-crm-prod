import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { executeIntegration } from '@/lib/lead-integration-engine';
import { buildLeadTemplateData } from '@/lib/lead-integration-data';
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

    const [integration, log] = await Promise.all([
      prisma.leadIntegration.findUnique({ where: { id: params.id } }),
      prisma.leadIntegrationLog.findUnique({ where: { id: params.logId } }),
    ]);
    if (!integration) return NextResponse.json({ error: 'Integration not found' }, { status: 404 });
    if (!log || log.integrationId !== params.id) {
      return NextResponse.json({ error: 'Log entry not found' }, { status: 404 });
    }
    if (!log.leadId) {
      return NextResponse.json({ error: 'This attempt used synthetic sample data and cannot be retried' }, { status: 400 });
    }

    const lead = await prisma.lead.findUnique({
      where: { id: log.leadId },
      include: { profile: true, referredBy: { select: { name: true } }, assignedTo: { select: { id: true, name: true, email: true, employeeCode: true, dialshreeId: true } } },
    });
    if (!lead) return NextResponse.json({ error: 'The original lead no longer exists' }, { status: 404 });

    const data = await buildLeadTemplateData(lead);
    const result = await executeIntegration(integration, data, {
      leadId: lead.id,
      isTest: log.isTest,
      retryOfLogId: log.id,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id]/logs/[logId]/retry POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
