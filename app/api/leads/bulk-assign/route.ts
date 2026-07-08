import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';

const bulkAssignSchema = z.object({
  leadIds: z.array(z.string()).min(1).max(200),
  agentId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || !['SUPER_ADMIN', 'COUNSELLING_TL'].includes(session.user.role)) {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = bulkAssignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const { leadIds, agentId } = parsed.data;

  // Verify agent belongs to TL's team — check via managedById OR team membership
  if (session.user.role === 'COUNSELLING_TL') {
    const agent = await prisma.user.findFirst({
      where: {
        id: agentId,
        role: 'COUNSELLING_AGENT',
        OR: [
          { managedById: session.user.id },
          { team: { teamLeadId: session.user.id } },
        ],
      },
    });
    if (!agent) return NextResponse.json({ success: false, error: 'Agent not in your team', code: 'FORBIDDEN' }, { status: 403 });
  }

  const agent = await prisma.user.findUnique({ where: { id: agentId }, select: { teamId: true, name: true } });

  // Fetch current assignee chain for each lead so we can shift it
  const currentLeads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, status: 'APPROVED' },
    select: { id: true, assignedToId: true, assignedFromId: true, assignedById: true },
  });

  await prisma.$transaction(async (tx) => {
    const now = new Date();
    for (const lead of currentLeads) {
      await tx.lead.update({
        where: { id: lead.id },
        data: {
          assignedToId:    agentId,
          assignedById:    session.user.id,
          assignedAt:      now,
          teamId:          agent?.teamId ?? null,
          assignedFromId:  lead.assignedToId  ?? null,
          prevAssignee2Id: lead.assignedById  ?? null,
        },
      });
    }
    await logActivity({
      userId: session.user.id,
      action: 'LEAD_ASSIGNED',
      description: `Bulk assigned ${leadIds.length} leads to agent "${agent?.name}"`,
      metadata: { leadIds, agentId },
    });
  });

  // Notify the agent outside the transaction — non-blocking so the response
  // isn't held up and a notification failure doesn't roll back the assignment
  prisma.notification.create({
    data: {
      userId: agentId,
      type:   'LEAD_ASSIGNED',
      title:  'New Leads Assigned',
      body:   `${leadIds.length} lead${leadIds.length !== 1 ? 's have' : ' has'} been assigned to you.`,
    },
  }).catch((err) => console.error('[bulk-assign] notification create failed:', err));

  return NextResponse.json({ success: true, assigned: leadIds.length });
  } catch (error) {
    console.error('[leads/bulk-assign POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
