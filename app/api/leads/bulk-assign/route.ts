import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { Feature } from '@prisma/client';

const bulkAssignSchema = z.object({
  leadIds: z.array(z.string()).min(1).max(200),
  agentId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || !(await hasPermission(session.user.role, Feature.ASSIGN_LEADS))) {
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

  /**
   * A deactivated agent cannot be assigned work, whoever is doing the assigning.
   *
   * The dropdowns no longer offer them, but a dropdown is not a guarantee: a tab
   * opened before the agent was deactivated still holds the old list, and this
   * route is reachable directly. Checked here so the rule holds regardless of
   * what the browser sends.
   *
   * Deactivation writes `isActive = false` AND `status = 'INACTIVE'` together
   * (see PATCH /api/users/[id]), so `isActive` alone is the whole test.
   *
   * Role is re-checked for the same reason — the TL branch above verifies it,
   * but a Super Admin never passed through that branch at all.
   */
  const agent = await prisma.user.findUnique({
    where: { id: agentId },
    select: { teamId: true, name: true, isActive: true, role: true },
  });
  if (!agent || agent.role !== 'COUNSELLING_AGENT') {
    return NextResponse.json({ success: false, error: 'Agent not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  if (!agent.isActive) {
    return NextResponse.json(
      { success: false, error: `${agent.name} is deactivated and cannot be assigned leads`, code: 'AGENT_INACTIVE' },
      { status: 400 },
    );
  }

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
      // See auto-assign: the notification records which leads it refers to.
      leadIds: leadIds.slice(0, 500),
    },
  }).catch((err) => console.error('[bulk-assign] notification create failed:', err));

  return NextResponse.json({ success: true, assigned: leadIds.length });
  } catch (error) {
    console.error('[leads/bulk-assign POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
