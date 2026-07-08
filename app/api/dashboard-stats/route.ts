import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const parse = (key: string) => searchParams.get(key)?.split(',').filter(Boolean) ?? [];
    const assignedToIdParam = parse('assignedToId');
    const cityParam         = parse('city');
    const stateParam        = parse('state');
    const courseParam       = parse('course');
    const leadTypeParam     = parse('leadType');
    const leadOriginParam   = parse('leadOrigin');
    const campaignParam     = parse('campaign');
    const feedbackParam     = parse('feedback');

    const role = session.user.role;
    const userId = session.user.id;

    const dateRange =
      from && to
        ? {
            gte: new Date(from + 'T00:00:00.000Z'),
            lte: new Date(to + 'T23:59:59.999Z'),
          }
        : undefined;

    const extraFilters: Prisma.LeadWhereInput = {
      ...(dateRange ? { createdAt: dateRange } : {}),
      ...(assignedToIdParam.length > 0 ? { assignedToId: { in: assignedToIdParam } } : {}),
      ...(cityParam.length > 0 ? { city: { in: cityParam } } : {}),
      ...(stateParam.length > 0 ? { state: { in: stateParam } } : {}),
      ...(courseParam.length > 0 ? { course: { in: courseParam } } : {}),
      ...(leadTypeParam.length > 0 ? { leadType: { in: leadTypeParam } } : {}),
      ...(leadOriginParam.length > 0 ? { leadOrigin: { in: leadOriginParam } } : {}),
      ...(campaignParam.length > 0 ? { campaign: { in: campaignParam } } : {}),
      ...(feedbackParam.length > 0 ? { currentFeedbackOptionId: { in: feedbackParam } } : {}),
    };

    // ── Role-based scope ─────────────────────────────────────────────────────
    // scopeWhere  → used for totalLeads / chart (broad scope)
    // teamScopeWhere → used for assignedLeads / connected / untouched / feedback
    //   null means "use scopeWhere for everything" (agent, ops, sa/reports)
    let scopeWhere: Prisma.LeadWhereInput = {};
    let teamScopeWhere: Prisma.LeadWhereInput | null = null;
    let teamAgentIds: string[] = [];
    let activeAgents = 0;
    let activeTLs = 0;

    if (role === 'COUNSELLING_AGENT') {
      // Scope: only leads assigned to this agent
      scopeWhere = { assignedToId: userId };
    } else if (role === 'COUNSELLING_TL') {
      const [directAgents, teamData] = await Promise.all([
        prisma.user.findMany({
          where: { managedById: userId, isActive: true },
          select: { id: true },
        }),
        prisma.team.findFirst({
          where: { teamLeadId: userId },
          select: { members: { select: { id: true } } },
        }),
      ]);
      teamAgentIds = Array.from(
        new Set([
          ...directAgents.map((a) => a.id),
          ...(teamData?.members.map((m) => m.id) ?? []),
        ])
      );
      activeAgents = teamAgentIds.length;
      // Total scope = ALL approved leads (the pool the TL assigns from)
      // Team scope  = leads assigned to THIS team's agents
      scopeWhere = {};
      teamScopeWhere = { assignedToId: { in: teamAgentIds } };
    } else if (role === 'OPERATIONS') {
      scopeWhere = { uploadedById: userId };
    } else {
      // SUPER_ADMIN, REPORTS
      const counts = await Promise.all([
        prisma.user.count({ where: { role: 'COUNSELLING_AGENT', isActive: true } }),
        prisma.user.count({ where: { role: 'COUNSELLING_TL', isActive: true } }),
      ]);
      activeAgents = counts[0];
      activeTLs = counts[1];
    }

    const baseWhere: Prisma.LeadWhereInput = { ...scopeWhere, ...extraFilters };
    const mainWhere: Prisma.LeadWhereInput = { ...baseWhere, status: 'APPROVED' };

    // teamWhere: for TL — restricts to team-assigned leads; for all other roles — same as mainWhere
    const teamWhere: Prisma.LeadWhereInput = teamScopeWhere
      ? { ...teamScopeWhere, status: 'APPROVED', ...extraFilters }
      : mainWhere;

    // ── Main counts (all in parallel) ────────────────────────────────────────
    const [
      teamAssignedCount,   // team-scoped for TL; equals mainWhere for all other roles
      connectedLeads,
      untouchedLeads,
      pendingLeads,
      approvedLeads,
      disapprovedLeads,
      unassignedLeadsRaw,  // only computed for SA / Reports / TL
      nonTeamAssignedRaw,  // only computed for SA / Reports / Ops
      leadsForChart,
    ] = await Promise.all([
      prisma.lead.count({ where: teamWhere }),
      prisma.lead.count({ where: { ...teamWhere, feedbacks: { some: {} } } }),
      prisma.lead.count({ where: { ...teamWhere, feedbacks: { none: {} } } }),
      prisma.lead.count({ where: { ...baseWhere, status: 'PENDING' } }),
      prisma.lead.count({ where: { ...baseWhere, status: 'APPROVED' } }),
      prisma.lead.count({ where: { ...baseWhere, status: 'DISAPPROVED' } }),
      role === 'SUPER_ADMIN' || role === 'REPORTS' || role === 'COUNSELLING_TL'
        ? prisma.lead.count({ where: { ...mainWhere, assignedToId: null } })
        : Promise.resolve(0),
      role === 'COUNSELLING_TL' || role === 'COUNSELLING_AGENT'
        ? Promise.resolve(0)
        : prisma.lead.count({ where: { ...mainWhere, assignedToId: { not: null } } }),
      prisma.lead.findMany({
        where: teamWhere,
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const unassignedLeads = unassignedLeadsRaw;

    // assignedLeads: for TL/Agent = teamAssignedCount (already team-scoped);
    //                for SA/Reports/Ops = leads with a non-null assignee.
    const assignedLeads = role === 'COUNSELLING_TL' || role === 'COUNSELLING_AGENT'
      ? teamAssignedCount
      : nonTeamAssignedRaw;

    // totalLeads:
    //   TL   → Assigned (team) + Unassigned (global pool) — matches what the cards sum to
    //   others → teamAssignedCount (= mainWhere count, equals assigned + unassigned anyway)
    const totalLeads = role === 'COUNSELLING_TL'
      ? teamAssignedCount + unassignedLeads
      : teamAssignedCount;

    // ── Feedback breakdown (per-lead, based on currentFeedbackOptionId) ──────
    const rawBreakdown = await prisma.lead.groupBy({
      by: ['currentFeedbackOptionId'],
      where: { ...teamWhere, currentFeedbackOptionId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 8,
    });

    const optionIds = rawBreakdown
      .map((r) => r.currentFeedbackOptionId)
      .filter((id): id is string => id !== null);

    const options =
      optionIds.length > 0
        ? await prisma.feedbackOption.findMany({
            where: { id: { in: optionIds } },
            select: { id: true, label: true },
          })
        : [];
    const optionMap = Object.fromEntries(options.map((o) => [o.id, o.label]));
    const feedbackBreakdown = rawBreakdown
      .filter((r) => r.currentFeedbackOptionId !== null)
      .map((r) => ({
        label: optionMap[r.currentFeedbackOptionId!] ?? 'Unknown',
        count: r._count.id,
      }));

    const applications =
      feedbackBreakdown.find((b) => b.label.toLowerCase().includes('application'))?.count ?? 0;
    const admissions =
      feedbackBreakdown.find((b) => b.label.toLowerCase().includes('admission'))?.count ?? 0;

    // ── Top agents ───────────────────────────────────────────────────────────
    let topAgents: { name: string; callCount: number }[] = [];
    if (role !== 'OPERATIONS' && role !== 'COUNSELLING_AGENT') {
      const topFeedbacks = await prisma.leadFeedback.groupBy({
        by: ['agentId'],
        where: {
          ...(dateRange ? { createdAt: dateRange } : {}),
          ...(teamAgentIds.length > 0 ? { agentId: { in: teamAgentIds } } : {}),
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      });
      if (topFeedbacks.length > 0) {
        const agentIds = topFeedbacks.map((f) => f.agentId);
        const users = await prisma.user.findMany({
          where: { id: { in: agentIds } },
          select: { id: true, name: true },
        });
        const nameMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
        topAgents = topFeedbacks.map((f) => ({
          name: nameMap[f.agentId] ?? 'Unknown',
          callCount: f._count.id,
        }));
      }
    }

    // ── Leads over time (group by day) ───────────────────────────────────────
    const dayMap = new Map<string, number>();
    for (const lead of leadsForChart) {
      const day = lead.createdAt.toISOString().split('T')[0];
      dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
    }
    const leadsOverTime = Array.from(dayMap.entries()).map(([date, count]) => ({ date, count }));

    return NextResponse.json({
      totalLeads,
      assignedLeads,
      unassignedLeads,
      connectedLeads,
      untouchedLeads,
      applications,
      admissions,
      activeAgents,
      activeTLs,
      pendingLeads,
      approvedLeads,
      disapprovedLeads,
      feedbackBreakdown,
      topAgents,
      leadsOverTime,
    });
  } catch (error) {
    console.error('[dashboard-stats GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
