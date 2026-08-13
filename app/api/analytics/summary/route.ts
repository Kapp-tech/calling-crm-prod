import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature, Prisma } from '@prisma/client';
import { istStartOfDay, istEndOfDay, istShiftDays } from '@/lib/ist-time';

// Stands in for "this user is scoped to a team, but has no team" so the
// team-filtered queries match nothing instead of silently going org-wide.
const NO_SUCH_TEAM = '__no_team__';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(await hasPermission(session.user.role, Feature.VIEW_REPORTS))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to   = searchParams.get('to');
    const teamId = searchParams.get('teamId') ?? undefined;

    // A Team Lead always sees exactly their own team, whatever `teamId` the
    // request asked for — so the param can't be used to read another team.
    // A TL who doesn't lead a team yet must see NOTHING rather than falling
    // through to the unscoped (org-wide) queries, hence the sentinel: it's a
    // team id that cannot exist, so every team-filtered count comes back 0.
    let effectiveTeamId = teamId;
    if (session.user.role === 'COUNSELLING_TL') {
      const tl = await prisma.user.findUnique({ where: { id: session.user.id }, select: { teamId: true } });
      effectiveTeamId = tl?.teamId ?? NO_SUCH_TEAM;
    }

    // IST calendar days — a bare date string parses as UTC and a trailing 'Z'
    // pins the upper bound to UTC, both of which shift the range by 5h30m.
    const dateFilter = from && to
      ? { createdAt: { gte: istStartOfDay(from), lte: istEndOfDay(to) } }
      : {};

    const teamFilter = effectiveTeamId ? { teamId: effectiveTeamId } : {};
    const approvedBase = { status: 'APPROVED' as const, ...teamFilter, ...dateFilter };
    const feedbackDateFilter = from && to
      ? { createdAt: { gte: istStartOfDay(from), lte: istEndOfDay(to) } }
      : {};

    const [
      totalLeads,
      pendingApproval,
      disapproved,
      approved,
      assigned,
      called,
      totalFeedbacks,
      feedbackDist,
      teamStats,
    ] = await Promise.all([
      // These three carry teamFilter too. Without it a Team Lead saw org-wide
      // Uploaded/Pending/Disapproved next to their own team's Approved and
      // Assigned — leaking other teams' volumes, and making the derived rates
      // ("Approval Rate" = team approved / global total) meaningless.
      prisma.lead.count({ where: { ...teamFilter, ...dateFilter } }),
      prisma.lead.count({ where: { status: 'PENDING', ...teamFilter, ...dateFilter } }),
      prisma.lead.count({ where: { status: 'DISAPPROVED', ...teamFilter, ...dateFilter } }),
      prisma.lead.count({ where: approvedBase }),
      prisma.lead.count({ where: { ...approvedBase, assignedToId: { not: null } } }),
      prisma.lead.count({ where: { ...approvedBase, feedbacks: { some: {} } } }),
      prisma.leadFeedback.count({
        where: {
          ...(effectiveTeamId ? { lead: { teamId: effectiveTeamId } } : {}),
          ...feedbackDateFilter,
        },
      }),
      prisma.feedbackOption.findMany({
        where: { isActive: true },
        select: {
          label: true,
          _count: {
            select: {
              feedbacks: {
                where: {
                  ...(effectiveTeamId ? { lead: { teamId: effectiveTeamId } } : {}),
                  ...feedbackDateFilter,
                },
              },
            },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.team.findMany({
        where: { isActive: true, ...(effectiveTeamId ? { id: effectiveTeamId } : {}) },
        select: {
          id: true, name: true,
          _count: { select: { leads: { where: approvedBase } } },
        },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Timeline: last 60 days (or within date range) — daily lead creation counts
    const timelineFrom = from ? istStartOfDay(from) : istStartOfDay(istShiftDays(new Date(), -60));
    const timelineTo   = to   ? istEndOfDay(to)     : new Date();

    // Grouped by IST day, not UTC day. "createdAt" is a timestamp WITHOUT time
    // zone holding UTC, so DATE_TRUNC on it bucketed by UTC date — filing
    // 18:30-24:00 IST activity under the following day. Shifting by the IST
    // offset before truncating gives the real IST calendar day; a fixed offset
    // is exact because India has never observed DST (see lib/ist-time.ts).
    //
    // Returned as TO_CHAR text rather than ::date so the day key never makes a
    // round trip through a JS Date, where a driver-local parse could shift it
    // back off by one.
    // Scoped to the same team as every other figure on the page — otherwise the
    // trend chart plotted org-wide volume beside team-scoped KPIs.
    const timelineTeamSql = effectiveTeamId
      ? Prisma.sql`AND "teamId" = ${effectiveTeamId}`
      : Prisma.empty;

    const timelineRaw = await prisma.$queryRaw<{ date: string; count: bigint }[]>`
      SELECT TO_CHAR("createdAt" + INTERVAL '5 hours 30 minutes', 'YYYY-MM-DD') AS date,
             COUNT(*)::bigint AS count
      FROM "Lead"
      WHERE "createdAt" >= ${timelineFrom} AND "createdAt" <= ${timelineTo}
      ${timelineTeamSql}
      GROUP BY 1
      ORDER BY 1
    `;

    const unassigned = Math.max(0, approved - assigned);
    const untouched  = Math.max(0, assigned - called);
    const interested = feedbackDist
      .filter((f) => f.label.toLowerCase().includes('interest'))
      .reduce((s, f) => s + f._count.feedbacks, 0);

    return NextResponse.json({
      kpis: {
        totalLeads,
        pendingApproval,
        disapproved,
        approved,
        assigned,
        unassigned,
        called,
        untouched,
        totalFeedbacks,
        interested,
        conversionRate: assigned > 0 ? Math.round((interested / assigned) * 100) : 0,
      },
      funnel: [
        { stage: 'Uploaded',  count: totalLeads, fill: '#6366f1' },
        { stage: 'Approved',  count: approved,   fill: '#8b5cf6' },
        { stage: 'Assigned',  count: assigned,   fill: '#a78bfa' },
        { stage: 'Called',    count: called,     fill: '#c4b5fd' },
        { stage: 'Interested', count: interested, fill: '#ddd6fe' },
      ],
      feedbackDistribution: feedbackDist
        .filter((f) => f._count.feedbacks > 0)
        .map((f) => ({ label: f.label, count: f._count.feedbacks })),
      timeline: timelineRaw.map((r) => ({
        date: r.date,
        count: Number(r.count),
      })),
      teams: teamStats.map((t) => ({ id: t.id, name: t.name, leads: t._count.leads })),
    });
  } catch (err) {
    console.error('[analytics/summary]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
