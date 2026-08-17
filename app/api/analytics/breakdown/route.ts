import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Feature, Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { istStartOfDay, istEndOfDay, toUtcSqlTimestamp } from '@/lib/ist-time';

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

    // IST calendar days, matching /api/analytics/summary. `new Date('2026-08-15')`
    // parses as UTC midnight and a trailing 'Z' pins the upper bound to UTC, so
    // this table used to cover a window shifted 5h30m from the KPIs directly
    // above it — the same date range produced two different answers.
    const dateFrom = from ? istStartOfDay(from) : null;
    const dateTo   = to   ? istEndOfDay(to)     : null;

    // Build dynamic WHERE clauses for raw SQL
    const conditions: Prisma.Sql[] = [Prisma.sql`l.status = 'APPROVED'`];
    if (effectiveTeamId) conditions.push(Prisma.sql`l."teamId" = ${effectiveTeamId}`);
    if (dateFrom && dateTo) {
      // Explicit UTC literals — see toUtcSqlTimestamp. Passing the Date objects
      // straight in made the window depend on the server's timezone.
      conditions.push(Prisma.sql`l."createdAt" >= ${toUtcSqlTimestamp(dateFrom)}::timestamp AND l."createdAt" <= ${toUtcSqlTimestamp(dateTo)}::timestamp`);
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
          -- Every count here must be DISTINCT on the lead. The LEFT JOIN below
          -- yields one row per feedback, so a lead with 3 feedbacks appeared 3
          -- times: COUNT(*) and a plain SUM(...) over those rows inflated
          -- Total and Assigned (measured at up to +21% against production).
          COUNT(DISTINCT l.id)::bigint                                                   AS total,
          COUNT(DISTINCT CASE WHEN l."assignedToId" IS NOT NULL THEN l.id END)::bigint  AS assigned,
          COUNT(DISTINCT lf."leadId")::bigint                                           AS called,
          COUNT(DISTINCT CASE WHEN l."assignedToId" IS NOT NULL AND lf."leadId" IS NULL THEN l.id END)::bigint AS untouched,
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
        leadConditions.push(Prisma.sql`l."createdAt" >= ${toUtcSqlTimestamp(dateFrom)}::timestamp AND l."createdAt" <= ${toUtcSqlTimestamp(dateTo)}::timestamp`);
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
          -- DISTINCT for the same fan-out reason as above: the LeadFeedback
          -- join repeats each lead once per feedback.
          COUNT(DISTINCT l.id)::bigint              AS total,
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
          -- DISTINCT for the same fan-out reason as above.
          COUNT(DISTINCT l.id)::bigint                                                   AS total,
          COUNT(DISTINCT CASE WHEN l."assignedToId" IS NOT NULL THEN l.id END)::bigint  AS assigned,
          COUNT(DISTINCT lf."leadId")::bigint                                           AS called,
          COUNT(DISTINCT CASE WHEN l."assignedToId" IS NOT NULL AND lf."leadId" IS NULL THEN l.id END)::bigint AS untouched,
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
      // EXISTS rather than a join to "Lead": as a JOIN predicate it would leave
      // the feedback row present with a NULL lead, so another team's feedback
      // would still be counted. As a WHERE predicate it would collapse the LEFT
      // JOIN to an INNER one and drop zero-count options. EXISTS restricts which
      // feedbacks match while keeping every option in the result.
      const feedbackTeamFilter = effectiveTeamId
        ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Lead" l WHERE l.id = lf."leadId" AND l."teamId" = ${effectiveTeamId})`
        : Prisma.empty;
      const feedbackDateFilter = dateFrom && dateTo
        ? Prisma.sql`AND lf."createdAt" >= ${toUtcSqlTimestamp(dateFrom)}::timestamp AND lf."createdAt" <= ${toUtcSqlTimestamp(dateTo)}::timestamp`
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
        -- Both predicates belong to the JOIN, not the WHERE. A condition on the
        -- right-hand table of a LEFT JOIN placed in WHERE silently turns it into
        -- an INNER JOIN, which made options with no feedback in the selected
        -- range vanish from the table instead of showing 0 — so the row list
        -- changed depending on whether a filter was applied.
        LEFT JOIN "LeadFeedback" lf
               ON lf."feedbackOptionId" = fo.id
              ${feedbackDateFilter}
              ${feedbackTeamFilter}
        WHERE fo."isActive" = true
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
