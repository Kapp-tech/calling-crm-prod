import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { istStartOfDay, istEndOfDay, istStartOfToday, istDayKey, istShiftDays, toUtcSqlTimestamp } from '@/lib/ist-time';
import { parseCsvFilterValues } from '@/lib/csv-filter-value';
import { Prisma } from '@prisma/client';

/**
 * A short per-viewer cache.
 *
 * Unlike the filter-options lists, this response DOES depend on the session —
 * an agent sees their own leads, a TL sees their team's, a Super Admin sees
 * everything — so a single shared cache would leak one person's figures to
 * another. The key is the viewer plus the exact filter string, which makes a
 * hit mean "this same person asked this same question seconds ago".
 *
 * Thirty seconds because nobody needs a lead count accurate to the second, and
 * the dashboard is the page people leave open and return to. It also absorbs
 * the case that hurts most on one core: several agents opening the dashboard at
 * the same moment, each firing the same ~19 queries.
 */
const STATS_TTL_MS = 30 * 1000;
const STATS_MAX_ENTRIES = 200;

const statsCache = new Map<string, { at: number; payload: unknown }>();

function cachedStats(key: string): unknown | null {
  const hit = statsCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= STATS_TTL_MS) {
    statsCache.delete(key);
    return null;
  }
  return hit.payload;
}

function storeStats(key: string, payload: unknown) {
  // Bounded: one entry per viewer per filter combination would otherwise grow
  // without limit on a long-running process. Oldest insertion goes first, which
  // is what Map iteration order gives us for free.
  if (statsCache.size >= STATS_MAX_ENTRIES) {
    const oldest = statsCache.keys().next().value;
    if (oldest !== undefined) statsCache.delete(oldest);
  }
  statsCache.set(key, { at: Date.now(), payload });
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);

    // After the auth check, before any query: a cache hit must never reach a
    // caller who has not proved who they are.
    const cacheKey = `${session.user.id}|${searchParams.toString()}`;
    const cached = cachedStats(cacheKey);
    if (cached) return NextResponse.json(cached);

    const from = searchParams.get('from');
    const to = searchParams.get('to');
    // A value can itself contain a comma (college names are often "Name,
    // City") — see lib/csv-filter-value.ts.
    const parse = (key: string) => parseCsvFilterValues(searchParams.get(key));
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
            // IST calendar days, not UTC days — a trailing 'Z' made the range
            // run 05:30 IST to 05:30 IST. See lib/ist-time.ts.
            gte: istStartOfDay(from),
            lte: istEndOfDay(to),
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
      unassignedLeadsRaw,  // only computed for SA / Reports / TL
      nonTeamAssignedRaw,  // only computed for SA / Reports / Ops
      applications,        // leads with at least one Application receipt uploaded
      admissions,          // leads with at least one Admission receipt uploaded
    ] = await Promise.all([
      prisma.lead.count({ where: teamWhere }),
      prisma.lead.count({ where: { ...teamWhere, feedbacks: { some: {} } } }),
      prisma.lead.count({ where: { ...teamWhere, feedbacks: { none: {} } } }),
      role === 'SUPER_ADMIN' || role === 'REPORTS' || role === 'COUNSELLING_TL'
        ? prisma.lead.count({ where: { ...mainWhere, assignedToId: null } })
        : Promise.resolve(0),
      role === 'COUNSELLING_TL' || role === 'COUNSELLING_AGENT'
        ? Promise.resolve(0)
        : prisma.lead.count({ where: { ...mainWhere, assignedToId: { not: null } } }),
      // Approved only — a receipt merely uploaded and awaiting Super Admin
      // review isn't a confirmed application/admission yet.
      prisma.lead.count({ where: { ...teamWhere, receipts: { some: { type: 'APPLICATION', status: 'APPROVED' } } } }),
      prisma.lead.count({ where: { ...teamWhere, receipts: { some: { type: 'ADMISSION', status: 'APPROVED' } } } }),
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

    // ── Top agents ───────────────────────────────────────────────────────────
    let topAgents: { name: string; callCount: number; todayCount: number }[] = [];
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
        const todayStart = istStartOfToday();
        const [users, todayFeedbacks] = await Promise.all([
          prisma.user.findMany({
            where: { id: { in: agentIds } },
            select: { id: true, name: true },
          }),
          // "X today" chip on the leaderboard — makes it feel live
          prisma.leadFeedback.groupBy({
            by: ['agentId'],
            where: { agentId: { in: agentIds }, createdAt: { gte: todayStart } },
            _count: { id: true },
          }),
        ]);
        const nameMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
        const todayMap = Object.fromEntries(todayFeedbacks.map((f) => [f.agentId, f._count.id]));
        topAgents = topFeedbacks.map((f) => ({
          name: nameMap[f.agentId] ?? 'Unknown',
          callCount: f._count.id,
          todayCount: todayMap[f.agentId] ?? 0,
        }));
      }
    }

    // ── 7-day sparklines for stat cards (always trailing 7 days, ignores the
    //    page date filter — they show recent momentum, not the filtered range) ─
    const todayKey = istDayKey(new Date());
    const last7Days = Array.from({ length: 7 }, (_, i) => istShiftDays(todayKey, i - 6));
    const sparkStart = istStartOfDay(last7Days[0]);

    /**
     * Grouped in Postgres, not in JavaScript.
     *
     * These three used to be `findMany` calls that pulled every matching row
     * into Node — on 19 Sept that was **115,161 rows** across seven days
     * (58,374 created, 28,198 assigned, 28,589 follow-ups) — built that many
     * Date objects, and called istDayKey, which goes through
     * Intl.DateTimeFormat, on every one. All to draw 21 points. It was the same
     * defect as the Leads Over Time chart removed above, just bounded by a date
     * so it did not stand out.
     *
     * One GROUP BY returns ~7 rows per series and measured 102 ms — barely more
     * than a single one-day count (89 ms), so grouping beats both the old
     * fetch-everything approach and the obvious alternative of 21 separate
     * counts.
     *
     * The day key is computed in SQL with the IST offset rather than by casting
     * in JS, for the reason the old comment gave: the UTC day of an IST evening
     * is the next day, which would file 18:30–24:00 IST activity under tomorrow.
     *
     * ⚠ The scope below mirrors the Prisma `scopeWhere` / `teamScopeWhere` built
     * at the top of this route. It is derived from the same role, userId and
     * teamAgentIds, and deliberately sits in one place — but it IS a second
     * expression of the same access rule. Change one, change the other.
     */
    const sparkLeadScope: Prisma.Sql =
      role === 'COUNSELLING_AGENT' ? Prisma.sql`AND l."assignedToId" = ${userId}`
      : role === 'OPERATIONS'      ? Prisma.sql`AND l."uploadedById" = ${userId}`
      : Prisma.empty;                       // SUPER_ADMIN, REPORTS, TL: unscoped

    /**
     * A TL is scoped to their team even when that team is empty.
     *
     * The Prisma version sets `{ assignedToId: { in: teamAgentIds } }`
     * unconditionally for a TL, and `in: []` matches nothing. Testing only
     * `teamAgentIds.length > 0` here fell through to the unscoped branch, so a
     * TL with no members would have seen the WHOLE COMPANY's assigned leads
     * instead of zero. `AND false` reproduces what an empty `in` does.
     */
    const sparkAssignedScope: Prisma.Sql =
      role === 'COUNSELLING_TL'
        ? (teamAgentIds.length > 0
            ? Prisma.sql`AND l."assignedToId" IN (${Prisma.join(teamAgentIds)})`
            : Prisma.sql`AND false`)
        : sparkLeadScope;

    // Explicit UTC literal, never a JS Date — a Date is read in the process
    // timezone and shifts the window by 5h30m on a UTC server.
    const sparkFrom = toUtcSqlTimestamp(sparkStart);
    const ISTDAY = Prisma.sql`interval '5 hours 30 minutes'`;

    type DayCount = { day: string; n: number };
    const [sparkCreated, sparkAssigned, sparkFeedbacks] = await Promise.all([
      prisma.$queryRaw<DayCount[]>(Prisma.sql`
        SELECT to_char(l."createdAt" + ${ISTDAY}, 'YYYY-MM-DD') AS day, count(*)::int AS n
        FROM "Lead" l
        WHERE l.status = 'APPROVED' AND l."createdAt" >= ${sparkFrom}::timestamp
          ${sparkLeadScope}
        GROUP BY 1`),
      prisma.$queryRaw<DayCount[]>(Prisma.sql`
        SELECT to_char(l."assignedAt" + ${ISTDAY}, 'YYYY-MM-DD') AS day, count(*)::int AS n
        FROM "Lead" l
        WHERE l.status = 'APPROVED' AND l."assignedAt" >= ${sparkFrom}::timestamp
          ${sparkAssignedScope}
        GROUP BY 1`),
      prisma.$queryRaw<DayCount[]>(Prisma.sql`
        SELECT to_char(f."createdAt" + ${ISTDAY}, 'YYYY-MM-DD') AS day, count(*)::int AS n
        FROM "LeadFeedback" f
        ${role === 'OPERATIONS' ? Prisma.sql`JOIN "Lead" l ON l.id = f."leadId"` : Prisma.empty}
        WHERE f."createdAt" >= ${sparkFrom}::timestamp
          ${role === 'COUNSELLING_AGENT'
            ? Prisma.sql`AND f."agentId" = ${userId}`
            : role === 'OPERATIONS'
              ? Prisma.sql`AND l."uploadedById" = ${userId}`
              : teamAgentIds.length > 0
                ? Prisma.sql`AND f."agentId" IN (${Prisma.join(teamAgentIds)})`
                : Prisma.empty}
        GROUP BY 1`),
    ]);

    /** Rows keyed by day -> one value per day in last7Days, zero-filled. */
    const toSeries = (rows: DayCount[]): number[] => {
      const byDay = new Map(rows.map((r) => [r.day, Number(r.n)]));
      return last7Days.map((d) => byDay.get(d) ?? 0);
    };

    const sparklines = {
      totalLeads: toSeries(sparkCreated),
      assignedLeads: toSeries(sparkAssigned),
      connectedLeads: toSeries(sparkFeedbacks),
    };

    /**
     * Leads Over Time and Status Breakdown were removed from the dashboard on
     * 19 Sept, and their queries with them — the point of removing a panel is
     * not to hide the work but to stop doing it.
     *
     * Leads Over Time cost 6.8 SECONDS of database time on its own. It fetched
     * every lead's createdAt — 135,469 rows, unbounded and sorted — then built
     * that many Date objects and called istDayKey (Intl.DateTimeFormat) on each
     * one to group them by day in JavaScript, to draw a chart of about 45
     * points. If it is ever wanted back, it must be a GROUP BY day in Postgres
     * returning ~45 rows, never a findMany.
     *
     * Status Breakdown was three counts, ~214 ms.
     */

    const payload = {
      totalLeads,
      assignedLeads,
      unassignedLeads,
      connectedLeads,
      untouchedLeads,
      applications,
      admissions,
      activeAgents,
      activeTLs,
      feedbackBreakdown,
      topAgents,
      sparklines,
    };

    storeStats(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[dashboard-stats GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
