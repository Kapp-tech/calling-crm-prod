import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { syncTeamMembersToLead } from '@/lib/team-sync';

const updateSchema = z.object({
  name: z.string().min(2).optional(),
  description: z.string().optional(),
  teamLeadId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const agentSelect = {
    id: true, name: true, email: true, phone: true, employeeCode: true, status: true, isActive: true,
    _count: { select: { assignedLeads: true, feedbacks: true } },
  } as const;

  const team = await prisma.team.findUnique({
    where: { id: params.id },
    include: {
      teamLead: { select: { id: true, name: true, email: true, phone: true, employeeCode: true } },
      // Agents linked via teamId
      members: { where: { role: 'COUNSELLING_AGENT', isActive: true }, select: agentSelect },
      _count: { select: { members: true, leads: true } },
    },
  });

  if (!team) return NextResponse.json({ success: false, error: 'Team not found', code: 'NOT_FOUND' }, { status: 404 });

  // TL can only see their own team
  if (session.user.role === 'COUNSELLING_TL' && team.teamLeadId !== session.user.id) {
    return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  // Also fetch agents linked via managedById (handles legacy agents where teamId wasn't set)
  const agentsViaManagedBy = team.teamLeadId
    ? await prisma.user.findMany({
        where: {
          role: 'COUNSELLING_AGENT',
          isActive: true,
          managedById: team.teamLeadId,
          teamId: { not: params.id }, // exclude already included via teamId
        },
        select: agentSelect,
      })
    : [];

  // Merge, dedup by id
  const allAgentIds = new Set(team.members.map((m) => m.id));
  const mergedMembers = [
    ...team.members,
    ...agentsViaManagedBy.filter((a) => !allAgentIds.has(a.id)),
  ];

  return NextResponse.json({ ...team, members: mergedMembers });
  } catch (error) {
    console.error('[teams/[id] GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const { teamLeadId, ...rest } = parsed.data;

  const team = await prisma.$transaction(async (tx) => {
    // If changing TL: unlink old TL's teamId, link new TL
    if (teamLeadId !== undefined) {
      const oldTeam = await tx.team.findUnique({ where: { id: params.id }, select: { teamLeadId: true } });
      if (oldTeam?.teamLeadId && oldTeam.teamLeadId !== teamLeadId) {
        await tx.user.update({ where: { id: oldTeam.teamLeadId }, data: { teamId: null } });
      }
      if (teamLeadId) {
        await tx.user.update({ where: { id: teamLeadId }, data: { teamId: params.id } });
      }
      // Re-point the members at the incoming lead too, or their "Manager"
      // keeps naming whoever used to run this team. See lib/team-sync.ts.
      await syncTeamMembersToLead(tx, params.id, teamLeadId ?? null);
    }
    const updated = await tx.team.update({
      where: { id: params.id },
      data: { ...rest, ...(teamLeadId !== undefined ? { teamLeadId } : {}) },
    });
    await logActivity({ userId: session.user.id, action: 'TEAM_UPDATED', targetId: params.id, targetType: 'Team', description: `Updated team "${updated.name}"` });
    return updated;
  });

  return NextResponse.json(team);
  } catch (error) {
    console.error('[teams/[id] PATCH]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    await prisma.team.update({ where: { id: params.id }, data: { isActive: false } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[teams/[id] DELETE]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
