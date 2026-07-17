import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || !(await hasPermission(session.user.role, Feature.VIEW_REPORTS))) {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fromDate = searchParams.get('from');
  const toDate = searchParams.get('to');
  const teamId = searchParams.get('teamId');

  const dateFilter = fromDate && toDate
    ? { createdAt: { gte: new Date(fromDate), lte: new Date(toDate) } }
    : {};

  // TL: scoped to their team
  const teamFilter = session.user.role === 'COUNSELLING_TL'
    ? { teamId: (await prisma.user.findUnique({ where: { id: session.user.id }, select: { teamId: true } }))?.teamId ?? undefined }
    : teamId ? { teamId } : {};

  const teams = await prisma.team.findMany({
    where: {
      isActive: true,
      ...(session.user.role === 'COUNSELLING_TL' ? { teamLeadId: session.user.id } : {}),
      ...(teamId && session.user.role === 'SUPER_ADMIN' ? { id: teamId } : {}),
    },
    include: {
      teamLead: { select: { id: true, name: true } },
      members: {
        where: { role: 'COUNSELLING_AGENT', isActive: true },
        select: {
          id: true, name: true,
          assignedLeads: {
            where: { ...teamFilter, ...dateFilter },
            select: { id: true, status: true },
          },
          feedbacks: {
            where: dateFilter,
            select: { id: true, createdAt: true, feedbackOption: { select: { label: true } } },
          },
        },
      },
      leads: {
        where: { ...teamFilter, ...dateFilter },
        select: { id: true, status: true, assignedToId: true },
      },
    },
  });

  const result = teams.map((team) => {
    const totalLeads = team.leads.length;
    const assignedLeads = team.leads.filter((l) => l.assignedToId).length;
    const agents = team.members.map((agent) => {
      const total = agent.assignedLeads.length;
      const interested = agent.feedbacks.filter((f) => f.feedbackOption?.label?.toLowerCase().includes('interested')).length;
      const feedbackCount = agent.feedbacks.length;

      // Last 7 days activity
      const last7 = Array.from({ length: 7 }).map((_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        d.setHours(0, 0, 0, 0);
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        return {
          date: d.toISOString().split('T')[0],
          count: agent.feedbacks.filter((f) => {
            const fd = new Date(f.createdAt);
            return fd >= d && fd < next;
          }).length,
        };
      });

      return {
        id: agent.id,
        name: agent.name,
        totalAssigned: total,
        feedbackGiven: feedbackCount,
        interested,
        conversionRate: total > 0 ? Math.round((interested / total) * 100) : 0,
        last7Days: last7,
      };
    });

    return {
      teamId: team.id,
      teamName: team.name,
      teamLead: team.teamLead,
      totalLeads,
      assignedLeads,
      agents,
      agentCount: team.members.length,
    };
  });

  return NextResponse.json(result);
  } catch (error) {
    console.error('[reports/performance GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
