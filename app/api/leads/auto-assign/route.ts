import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { Feature } from '@prisma/client';

const autoAssignSchema = z.object({
  leadIds:        z.array(z.string()).min(1).max(10000),
  agentIds:       z.array(z.string()).optional(),
  resetFeedbacks: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || !(await hasPermission(session.user.role, Feature.ASSIGN_LEADS))) {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = autoAssignSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const { leadIds, agentIds: restrictToAgentIds, resetFeedbacks } = parsed.data;

  // Get TL's team
  const tl = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { teamId: true },
  });

  if (!tl?.teamId && session.user.role === 'COUNSELLING_TL') {
    return NextResponse.json({ success: false, error: 'You are not assigned to a team', code: 'NO_TEAM' }, { status: 400 });
  }

  // Get all active agents with their current lead counts for round-robin
  const agents = await prisma.user.findMany({
    where: {
      role: 'COUNSELLING_AGENT',
      isActive: true,
      ...(session.user.role === 'COUNSELLING_TL' ? { managedById: session.user.id } : {}),
      ...(restrictToAgentIds?.length ? { id: { in: restrictToAgentIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      teamId: true,
      _count: { select: { assignedLeads: true } },
    },
    orderBy: { name: 'asc' },
  });

  if (agents.length === 0) {
    return NextResponse.json({ success: false, error: 'No active agents found', code: 'NO_AGENTS' }, { status: 400 });
  }

  // Sort by current load (fewest leads first) for fair round-robin
  const sorted = [...agents].sort((a, b) => a._count.assignedLeads - b._count.assignedLeads);

  const assignments: { leadId: string; agentId: string }[] = [];
  leadIds.forEach((leadId, i) => {
    assignments.push({ leadId, agentId: sorted[i % sorted.length].id });
  });

  // Fetch current assignee chain so we can shift it
  const currentLeads = await prisma.lead.findMany({
    where: { id: { in: leadIds } },
    select: { id: true, assignedToId: true, assignedFromId: true, assignedById: true },
  });
  const leadChainMap = new Map(currentLeads.map((l) => [l.id, l]));

  // Group lead IDs by the agent they were assigned to (for bulk updateMany per agent)
  const agentLeadMap = new Map<string, string[]>();
  for (const { leadId, agentId } of assignments) {
    if (!agentLeadMap.has(agentId)) agentLeadMap.set(agentId, []);
    agentLeadMap.get(agentId)!.push(leadId);
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();

    if (resetFeedbacks) {
      await tx.leadFeedback.deleteMany({ where: { leadId: { in: leadIds } } });
      await tx.scheduledCall.updateMany({
        where: { leadId: { in: leadIds }, status: 'PENDING' },
        data:  { status: 'CANCELLED' },
      });
    }

    // Individual update per lead so the assignment chain (assignedFrom, prevAssignee2) is shifted correctly per lead
    for (const { leadId, agentId } of assignments) {
      const agent = agents.find((a) => a.id === agentId)!;
      const current = leadChainMap.get(leadId);
      await tx.lead.update({
        where: { id: leadId },
        data:  {
          assignedToId:    agentId,
          assignedById:    session.user.id,
          assignedAt:      now,
          teamId:          agent.teamId ?? null,
          assignedFromId:  current?.assignedToId  ?? null,
          prevAssignee2Id: current?.assignedById  ?? null,
          ...(resetFeedbacks ? { currentFeedbackOptionId: null } : {}),
        },
      });
    }

    await logActivity({
      userId: session.user.id,
      action: 'LEAD_ASSIGNED',
      description: `Auto-assigned ${leadIds.length} leads across ${agents.length} agents (round-robin)`,
      metadata: { leadIds: leadIds.length, agentCount: agents.length },
    });
  }, { timeout: 30000 });

  // Notify each agent that received at least one lead (non-blocking — assignment already committed)
  const notifData = Array.from(agentLeadMap.entries()).map(([agentId, agentLeadIds]) => ({
    userId: agentId,
    type:   'LEAD_ASSIGNED' as const,
    title:  'New Leads Assigned',
    body:   `${agentLeadIds.length} lead${agentLeadIds.length !== 1 ? 's have' : ' has'} been assigned to you.`,
  }));
  if (notifData.length > 0) {
    prisma.notification.createMany({ data: notifData })
      .catch((err) => console.error('[auto-assign] notification create failed:', err));
  }

  // Return load summary
  const summary = sorted.map((a) => ({
    agentId: a.id,
    agentName: a.name,
    assigned: assignments.filter((x) => x.agentId === a.id).length,
    total: a._count.assignedLeads + assignments.filter((x) => x.agentId === a.id).length,
  }));

  return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error('[leads/auto-assign POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
