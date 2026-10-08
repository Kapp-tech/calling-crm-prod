import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature } from '@prisma/client';
import { unassignLeads } from '@/lib/lead-unassign';

const schema = z.object({
  leadIds: z.array(z.string()).min(1).max(500),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(await hasPermission(session.user.role, Feature.ASSIGN_LEADS))) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.flatten() }, { status: 400 });
    }

    const { leadIds } = parsed.data;

    // TL: ensure every lead being unassigned belongs to their team
    if (session.user.role === 'COUNSELLING_TL') {
      const [directAgents, teamData] = await Promise.all([
        prisma.user.findMany({
          where: { managedById: session.user.id, isActive: true },
          select: { id: true },
        }),
        prisma.team.findFirst({
          where: { teamLeadId: session.user.id },
          select: { members: { select: { id: true } } },
        }),
      ]);

      const teamAgentIds = new Set([
        ...directAgents.map((a) => a.id),
        ...(teamData?.members.map((m) => m.id) ?? []),
      ]);

      const assignedLeads = await prisma.lead.findMany({
        where: { id: { in: leadIds }, assignedToId: { not: null } },
        select: { id: true, assignedToId: true },
      });

      const outsideTeam = assignedLeads.filter(
        (l) => l.assignedToId && !teamAgentIds.has(l.assignedToId)
      );
      if (outsideTeam.length > 0) {
        return NextResponse.json(
          { success: false, error: 'Some leads are assigned to agents outside your team' },
          { status: 403 }
        );
      }
    }

    // Shared with user deactivation — see lib/lead-unassign.ts for what
    // "unassigned" has to mean for a lead to actually return to the queue.
    const count = await prisma.$transaction((tx) => unassignLeads(tx, { id: { in: leadIds } }));

    return NextResponse.json({ success: true, unassigned: count });
  } catch (error) {
    console.error('[leads/bulk-unassign POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
