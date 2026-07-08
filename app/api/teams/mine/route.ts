import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const agentSelect = {
  id: true, name: true, email: true, phone: true,
  employeeCode: true, status: true, isActive: true,
  _count: { select: { assignedLeads: true, feedbacks: true } },
} as const;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const role = session.user.role;

    if (role === 'COUNSELLING_TL') {
      const team = await prisma.team.findFirst({
        where: { teamLeadId: session.user.id },
        include: {
          teamLead: { select: { id: true, name: true, email: true, phone: true, employeeCode: true } },
          members: { where: { role: 'COUNSELLING_AGENT' }, select: agentSelect },
          _count: { select: { members: true, leads: true } },
        },
      });
      if (!team) return NextResponse.json(null);

      // Also fetch agents linked via managedById
      const viaManagedBy = await prisma.user.findMany({
        where: { role: 'COUNSELLING_AGENT', managedById: session.user.id, teamId: { not: team.id } },
        select: agentSelect,
      });
      const seen = new Set(team.members.map((m) => m.id));
      return NextResponse.json({ ...team, members: [...team.members, ...viaManagedBy.filter((a) => !seen.has(a.id))] });
    }

    if (role === 'COUNSELLING_AGENT') {
      const me = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { teamId: true, managedById: true },
      });
      const teamId = me?.teamId;
      const managedById = me?.managedById;

      let team = teamId
        ? await prisma.team.findUnique({
            where: { id: teamId },
            include: {
              teamLead: { select: { id: true, name: true, email: true, phone: true, employeeCode: true } },
              members: { where: { role: 'COUNSELLING_AGENT' }, select: agentSelect },
              _count: { select: { members: true, leads: true } },
            },
          })
        : null;

      // Fallback: find team via TL's managedById
      if (!team && managedById) {
        team = await prisma.team.findFirst({
          where: { teamLeadId: managedById },
          include: {
            teamLead: { select: { id: true, name: true, email: true, phone: true, employeeCode: true } },
            members: { where: { role: 'COUNSELLING_AGENT' }, select: agentSelect },
            _count: { select: { members: true, leads: true } },
          },
        });
      }

      if (!team) return NextResponse.json(null);

      // Merge agents that are linked via managedById to TL but not in teamId
      const tlId = team.teamLead?.id ?? managedById;
      const viaManagedBy = tlId
        ? await prisma.user.findMany({
            where: { role: 'COUNSELLING_AGENT', managedById: tlId, teamId: { not: team.id } },
            select: agentSelect,
          })
        : [];
      const seen = new Set(team.members.map((m) => m.id));
      return NextResponse.json({ ...team, members: [...team.members, ...viaManagedBy.filter((a) => !seen.has(a.id))] });
    }

    return NextResponse.json({ error: 'Not applicable for this role' }, { status: 400 });
  } catch (error) {
    console.error('[teams/mine GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
