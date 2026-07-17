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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const from = searchParams.get('from');
    const to   = searchParams.get('to');
    const teamId = searchParams.get('teamId') ?? undefined;

    // TL: always scoped to their own team
    let effectiveTeamId = teamId;
    if (session.user.role === 'COUNSELLING_TL') {
      const tl = await prisma.user.findUnique({ where: { id: session.user.id }, select: { teamId: true } });
      effectiveTeamId = tl?.teamId ?? undefined;
    }

    const dateFilter = from && to
      ? { createdAt: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999Z`) } }
      : {};

    const teamFilter = effectiveTeamId ? { teamId: effectiveTeamId } : {};
    const approvedBase = { status: 'APPROVED' as const, ...teamFilter, ...dateFilter };
    const feedbackDateFilter = from && to
      ? { createdAt: { gte: new Date(from), lte: new Date(`${to}T23:59:59.999Z`) } }
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
      prisma.lead.count({ where: dateFilter }),
      prisma.lead.count({ where: { status: 'PENDING', ...dateFilter } }),
      prisma.lead.count({ where: { status: 'DISAPPROVED', ...dateFilter } }),
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
    const timelineFrom = from ? new Date(from) : new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const timelineTo   = to   ? new Date(`${to}T23:59:59.999Z`) : new Date();

    const timelineRaw = await prisma.$queryRaw<{ date: Date; count: bigint }[]>`
      SELECT DATE_TRUNC('day', "createdAt")::date AS date, COUNT(*)::bigint AS count
      FROM "Lead"
      WHERE "createdAt" >= ${timelineFrom} AND "createdAt" <= ${timelineTo}
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
        date: r.date.toISOString().split('T')[0],
        count: Number(r.count),
      })),
      teams: teamStats.map((t) => ({ id: t.id, name: t.name, leads: t._count.leads })),
    });
  } catch (err) {
    console.error('[analytics/summary]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
