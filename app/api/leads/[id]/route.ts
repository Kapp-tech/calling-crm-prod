import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isMaskedRole } from '@/lib/permissions';
import { maskContact } from '@/lib/data-masking';
import { getLeadWhereClause } from '@/lib/lead-access';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const lead = await prisma.lead.findFirst({
      where: { AND: [{ id: params.id }, getLeadWhereClause(session.user)] },
      include: {
        uploadedBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        assignedTo:    { select: { id: true, name: true } },
        assignedBy:    { select: { id: true, name: true } },
        assignedFrom:  { select: { id: true, name: true } },
        prevAssignee2: { select: { id: true, name: true } },
        feedbacks: {
          include: {
            agent: { select: { id: true, name: true } },
            feedbackOption: { select: { id: true, label: true } },
          },
          orderBy: { followUpNumber: 'asc' },
        },
        // Newest first — the drawer reads it top-down as a timeline.
        // id as a tiebreaker: createdAt is millisecond-precision, so two
        // stages applied back-to-back can share one timestamp. cuid ids are
        // time-prefixed, so they order by insertion.
        stageHistory: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
        profile: true,
      },
    });

    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    // TL/Super Admin/Reports (anyone but the assigned agent) can also see
    // feedback archived by a previous "reassign as fresh" reset — the agent
    // themselves only ever sees the live (current-cycle) `feedbacks` above,
    // so a freshly-assigned lead reads as clean to them.
    let archivedFeedbacks: unknown[] = [];
    if (session.user.role !== 'COUNSELLING_AGENT') {
      archivedFeedbacks = await prisma.leadFeedbackArchive.findMany({
        where: { leadId: params.id },
        include: {
          agent:         { select: { id: true, name: true } },
          feedbackOption:{ select: { id: true, label: true } },
          archivedBy:    { select: { id: true, name: true } },
        },
        orderBy: [{ cycle: 'asc' }, { followUpNumber: 'asc' }],
      });
    }

    const masked = await isMaskedRole(session.user.role);
    return NextResponse.json({ ...maskContact(lead, masked), archivedFeedbacks, masked });
  } catch (error) {
    console.error('[leads/[id] GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['SUPER_ADMIN', 'REPORTS'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const lead = await prisma.lead.findUnique({ where: { id: params.id } });
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    if (lead.status !== 'DISAPPROVED' && session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Can only delete disapproved leads' }, { status: 400 });
    }

    await prisma.lead.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[leads/[id] DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
