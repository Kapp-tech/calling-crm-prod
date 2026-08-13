import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Feature, Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';

export type BreakdownRow = {
  label: string;
  subLabel?: string;
  total: number;
  assigned: number;
  called: number;
  untouched: number;
  feedbacks: number;
  convPct: number;
};

type GroupBy = 'city' | 'state' | 'counsellor' | 'team' | 'college' | 'course' | 'feedback';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(await hasPermission(session.user.role, Feature.VIEW_REPORTS))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const groupBy  = (searchParams.get('groupBy') ?? 'city') as GroupBy;
    const from     = searchParams.get('from');
    const to       = searchParams.get('to');
    const rawTeamId = searchParams.get('teamId');

    // A Team Lead is pinned to their own team regardless of the requested
    // `teamId`. If they don't lead a team yet, fall back to a team id that
    // cannot exist rather than to null — null drops the WHERE clause entirely
    // and would return every team's rows.
    let effectiveTeamId: string | null = rawTeamId;
    if (session.user.role === 'COUNSELLING_TL') {
      const tl = await prisma.user.findUnique({ where: { id: session.user.id }, select: { teamId: true } });
      effectiveTeamId = tl?.teamId ?? '__no_team__';
    }

    const dateFrom = from ? new Date(from) : null;
    const dateTo   = to   ? new Date(`${to}T23:59:59.999Z`) : null;

    // Build dynamic WHERE clauses for raw SQL
    const conditions: Prisma.Sql[] = [Prisma.sql`l.status = 'APPROVED'`];
    if (effectiveTeamId) conditions.push(Prisma.sql`l."teamId" = ${effectiveTeamId}`);
    if (dateFrom && dateTo) {
      conditions.push(Prisma.sql`l."createdAt" >= ${dateFrom} AND l."createdAt" <= ${dateTo}`);
    }
    const whereClause = Prisma.join(conditions, ' AND ');

    let rows: BreakdownRow[] = [];

    if (groupBy === 'city' || groupBy === 'state' || groupBy === 'college' || groupBy === 'course') {
      const col =
        groupBy === 'city'    ? Prisma.sql`l.city`    :
        groupBy === 'state'   ? Prisma.sql`l.state`   :
        groupBy === 'college' ? Prisma.sql`l.college` :
                                Prisma.sql`l.course`;

      const raw = await prisma.$queryRaw<{
        label: string | null;
        total: bigint;
        assigned: bigint;
        called: bigint;
        untouched: bigint;
        feedbacks: bigint;
      }[]>`
        SELECT
          COALESCE(${col}, '(Unknown)') AS label,
          COUNT(*)::bigint                                                               AS total,
          SUM(CASE WHEN l."assignedToId" IS NOT NULL THEN 1 ELSE 0 END)::bigint         AS assigned,
          COUNT(DISTINCT lf."leadId")::bigint                                           AS called,
          SUM(CASE WHEN l."assignedToId" IS NOT NULL AND lf."leadId" IS NULL THEN 1 ELSE 0 END)::bigint AS untouched,
          COUNT(lf.id)::bigint                                                          AS feedbacks
        FROM "Lead" l
        LEFT JOIN "LeadFeedback" lf ON lf."leadId" = l.id
        WHERE ${whereClause}
        GROUP BY 1
        ORDER BY total DESC
        LIMIT 30
      `;

      rows = raw.map((r) => ({
        label:    r.label ?? '(Unknown)',
        total:    Number(r.total),
        assigned: Number(r.assigned),
        called:   Number(r.called),
        untouched: Number(r.untouched),
        feedbacks: Number(r.feedbacks),
        convPct:  Number(r.total) > 0 ? Math.round((Number(r.called) / Number(r.total)) * 100) : 0,
      }));
    }

    else if (groupBy === 'counsellor') {
      const agentConditions: Prisma.Sql[] = [
        Prisma.sql`u.role = 'COUNSELLING_AGENT'`,
        Prisma.sql`u."isActive" = true`,
      ];
      if (effectiveTeamId) agentConditions.push(Prisma.sql`u."teamId" = ${effectiveTeamId}`);
      const agentWhere = Prisma.join(agentConditions, ' AND ');

      const leadConditions: Prisma.Sql[] = [Prisma.sql`l.status = 'APPROVED'`];
      if (effectiveTeamId) leadConditions.push(Prisma.sql`l."teamId" = ${effectiveTeamId}`);
      if (dateFrom && dateTo) {
        leadConditions.push(Prisma.sql`l."createdAt" >= ${dateFrom} AND l."createdAt" <= ${dateTo}`);
      }
      const leadWhere = Prisma.join(leadConditions, ' AND ');

      const raw = await prisma.$queryRaw<{
        label: string;
        sublabel: string | null;
        total: bigint;
        called: bigint;
        untouched: bigint;
        feedbacks: bigint;
      }[]>`
        SELECT
          u.name                                    AS label,
          t.name                                    AS sublabel,
          COUNT(l.id)::bigint                       AS total,
          COUNT(DISTINCT CASE WHEN lf."leadId" IS NOT NULL THEN l.id END)::bigint AS called,
          COUNT(DISTINCT CASE WHEN lf."leadId" IS NULL AND l.id IS NOT NULL THEN l.id END)::bigint AS untouched,
          COUNT(lf.id)::bigint                      AS feedbacks
        FROM "User" u
        LEFT JOIN "Team" t ON t.id = u."teamId"
        LEFT JOIN "Lead" l ON l."assignedToId" = u.id AND ${leadWhere}
        LEFT JOIN "LeadFeedback" lf ON lf."leadId" = l.id
        WHERE ${agentWhere}
        GROUP BY u.id, u.name, t.name
        ORDER BY total DESC, u.name
      `;

      rows = raw.map((r) => ({
        label:    r.label,
        subLabel: r.sublabel ?? undefined,
        total:    Number(r.total),
        assigned: Number(r.total),
        called:   Number(r.called),
        untouched: Number(r.untouched),
        feedbacks: Number(r.feedbacks),
        convPct:  Number(r.total) > 0 ? Math.round((Number(r.called) / Number(r.total)) * 100) : 0,
      }));
    }

    else if (groupBy === 'team') {
      const raw = await prisma.$queryRaw<{
        label: string;
        total: bigint;
        assigned: bigint;
        called: bigint;
        untouched: bigint;
        feedbacks: bigint;
      }[]>`
        SELECT
          t.name                                                                         AS label,
          COUNT(l.id)::bigint                                                            AS total,
          SUM(CASE WHEN l."assignedToId" IS NOT NULL THEN 1 ELSE 0 END)::bigint         AS assigned,
          COUNT(DISTINCT lf."leadId")::bigint                                           AS called,
          SUM(CASE WHEN l."assignedToId" IS NOT NULL AND lf."leadId" IS NULL THEN 1 ELSE 0 END)::bigint AS untouched,
          COUNT(lf.id)::bigint                                                          AS feedbacks
        FROM "Team" t
        LEFT JOIN "Lead" l ON l."teamId" = t.id AND ${whereClause}
        LEFT JOIN "LeadFeedback" lf ON lf."leadId" = l.id
        WHERE t."isActive" = true ${effectiveTeamId ? Prisma.sql`AND t.id = ${effectiveTeamId}` : Prisma.empty}
        GROUP BY t.id, t.name
        ORDER BY total DESC
      `;

      rows = raw.map((r) => ({
        label:    r.label,
        total:    Number(r.total),
        assigned: Number(r.assigned),
        called:   Number(r.called),
        untouched: Number(r.untouched),
        feedbacks: Number(r.feedbacks),
        convPct:  Number(r.total) > 0 ? Math.round((Number(r.called) / Number(r.total)) * 100) : 0,
      }));
    }

    else if (groupBy === 'feedback') {
      const feedbackTeamFilter = effectiveTeamId
        ? Prisma.sql`AND l."teamId" = ${effectiveTeamId}`
        : Prisma.empty;
      const feedbackDateFilter = dateFrom && dateTo
        ? Prisma.sql`AND lf."createdAt" >= ${dateFrom} AND lf."createdAt" <= ${dateTo}`
        : Prisma.empty;

      const raw = await prisma.$queryRaw<{
        label: string;
        feedbacks: bigint;
        unique_leads: bigint;
      }[]>`
        SELECT
          fo.label                              AS label,
          COUNT(lf.id)::bigint                  AS feedbacks,
          COUNT(DISTINCT lf."leadId")::bigint   AS unique_leads
        FROM "FeedbackOption" fo
        LEFT JOIN "LeadFeedback" lf ON lf."feedbackOptionId" = fo.id
        LEFT JOIN "Lead" l ON l.id = lf."leadId"
        WHERE fo."isActive" = true ${feedbackTeamFilter} ${feedbackDateFilter}
        GROUP BY fo.id, fo.label, fo."sortOrder"
        ORDER BY feedbacks DESC, fo."sortOrder"
      `;

      rows = raw.map((r) => ({
        label:    r.label,
        total:    Number(r.unique_leads),
        assigned: Number(r.unique_leads),
        called:   Number(r.unique_leads),
        untouched: 0,
        feedbacks: Number(r.feedbacks),
        convPct:  0,
      }));
    }

    return NextResponse.json(rows);
  } catch (err) {
    console.error('[analytics/breakdown]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
