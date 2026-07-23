import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { executeIntegration } from '@/lib/lead-integration-engine';
import { SAMPLE_LEAD_DATA } from '@/lib/lead-integration-fields';
import { buildLeadTemplateData } from '@/lib/lead-integration-data';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

const testSchema = z.union([
  z.object({ leadId: z.string().min(1) }),
  z.object({ useSampleData: z.literal(true) }),
]);

// Sends a REAL request to the configured endpoint — there is no way to
// meaningfully test a third-party API without actually calling it. The
// frontend labels this clearly so an admin knows a live request is going out.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const integration = await prisma.leadIntegration.findUnique({ where: { id: params.id } });
    if (!integration) return NextResponse.json({ error: 'Integration not found' }, { status: 404 });

    const body = await req.json().catch(() => null);
    const parsed = testSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Provide either a leadId or useSampleData: true' }, { status: 400 });
    }

    let data: Record<string, unknown>;
    let leadId: string | null = null;

    if ('leadId' in parsed.data) {
      const lead = await prisma.lead.findUnique({
        where: { id: parsed.data.leadId },
        include: { profile: true, referredBy: { select: { name: true } }, assignedTo: { select: { name: true } } },
      });
      if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      data = await buildLeadTemplateData(lead);
      leadId = lead.id;
    } else {
      data = SAMPLE_LEAD_DATA;
    }

    const result = await executeIntegration(integration, data, { leadId, isTest: true });

    await logActivity({
      userId: session.user.id,
      action: 'LEAD_INTEGRATION_UPDATED',
      targetId: integration.id,
      targetType: 'LeadIntegration',
      description: `Sent a test request for lead integration "${integration.name}" (${result.success ? 'succeeded' : 'failed'})`,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id]/test POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
