import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildLeadTemplateData } from '@/lib/lead-integration-data';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

// Backs the Body Builder's Live Preview and the Test & Send tab when the
// admin picks a real lead instead of synthetic sample data — returns the
// exact flat key/value shape the template renderer consumes.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const leadId = req.nextUrl.searchParams.get('leadId');
    if (!leadId) return NextResponse.json({ error: 'leadId is required' }, { status: 400 });

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { profile: true, referredBy: { select: { name: true } }, assignedTo: { select: { name: true } } },
    });
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    return NextResponse.json(await buildLeadTemplateData(lead));
  } catch (error) {
    console.error('[super-admin/lead-integrations/preview-data GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
