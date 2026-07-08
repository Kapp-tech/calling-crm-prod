import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
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
        profile: true,
      },
    });

    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    return NextResponse.json(lead);
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
