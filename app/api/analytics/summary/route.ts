import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature, Prisma } from '@prisma/client';
import { istStartOfDay, istEndOfDay, istShiftDays, toUtcSqlTimestamp } from '@/lib/ist-time';

// Stands in for "this user is scoped to a team, but has no team" so the
// team-filtered queries match nothing instead of silently going org-wide.
const NO_SUCH_TEAM = '__no_team__';

// Which feedback labels mean the lead is actually interested.
//
// This used to be a bare `label.includes('interest')`, which also matches
// "Not Interested" — counting rejections as conversions. Production is spelled
// "Not Intrested", so the typo accidentally hid the bug; correcting that
// spelling would have silently inflated the KPI. Excluding negations makes it
// spelling-independent.
//
// A dedicated flag on FeedbackOption would be better than matching on text;
// the existing categories ("Connected" / "Not Connected") describe reachability
// rather than sentiment, so they can't stand in for it.
function isInterestedLabel(label: string): boolean {
  const l = label.toLowerCase();
  return l.includes('interest') && !/\bnot\b/.test(l);
}

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

    // Resolved up front so "Interested" can be counted as LEADS (below) rather
    // than as feedback rows.
    const allOptions = await prisma.feedbackOption.findMany({
      where: { isActive: true },
      select: { id: true, label: true },
    });
    const interestedOptionIds = allOptions.filter((o) => isInterestedLabel(o.label)).map((o) => o.id);

    // Resolved here rather than hardcoded so the cards follow Manage Feedbacks.
    // The ids are handed to the client as well, because the cards deep-link into
    // All Leads and its feedback filter takes ids, not labels — building the
    // link from a label there would break the moment one is renamed.
    const exact = (label: string) =>
      allOptions.find((o) => o.label.trim().toLowerCase() === label)?.id ?? null;
    const hotOptionId = exact('hot');
    const warmOptionId = exact('warm');
    const connectedCategory = await prisma.feedbackCategory.findFirst({
      where: { name: { equals: 'Connected', mode: 'insensitive' } },
      select: { id: true },
    });
    const connectedCategoryId = connectedCategory?.id ?? null;
    const connectedOptionIds = connectedCategoryId
      ? (await prisma.feedbackOption.findMany({
          where: { categoryId: connectedCategoryId },
          select: { id: true },
        })).map((o) => o.id)
      : [];

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
      interested,
      untouched,
      applications,
      admissions,
      connectedLeads,
      hotLeads,
      warmLeads,
      talktimeSeconds,
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
      // Assigned-scoped, unlike before. Called is a subset of Assigned, so
      // counting approved-but-unassigned leads that carry feedback let it drift
      // above Assigned and made Untouched (assigned - called) come out short —
      // one lead short on local data.
      prisma.lead.count({
        where: { ...approvedBase, assignedToId: { not: null }, feedbacks: { some: {} } },
      }),
      prisma.leadFeedback.count({
        where: {
          ...(effectiveTeamId ? { lead: { teamId: effectiveTeamId } } : {}),
          ...feedbackDateFilter,
        },
      }),
      // Distribution over LEADS at their latest feedback, not over feedback
      // events. Counting events made this card disagree with the All Leads
      // chips and the dashboard's Feedback Breakdown, which both group by
      // Lead.currentFeedbackOptionId: a lead marked "Not Interested" twice and
      // later "Call Back" still contributed 2 to Not Interested here while
      // appearing only under Call Back everywhere else.
      //
      // The event count is still reported separately as the Total Feedbacks
      // KPI, which is what that number is for.
      prisma.lead.groupBy({
        by: ['currentFeedbackOptionId'],
        where: { ...approvedBase, currentFeedbackOptionId: { not: null } },
        _count: { id: true },
      }),
      prisma.team.findMany({
        where: { isActive: true, ...(effectiveTeamId ? { id: effectiveTeamId } : {}) },
        select: {
          id: true, name: true, teamLeadId: true,
          _count: { select: { leads: { where: approvedBase } } },
        },
        orderBy: { name: 'asc' },
      }),
      // Distinct LEADS with at least one interested feedback — not a count of
      // feedback rows. It is reported as a share of Called, so it has to be the
      // same unit; counting rows let a lead marked Interested twice appear
      // twice and could push the conversion rate past 100%.
      //
      // Scoped by approvedBase (lead creation date) like every other figure
      // here, so they all share one definition of the selected period.
      interestedOptionIds.length > 0
        ? prisma.lead.count({
            where: { ...approvedBase, currentFeedbackOptionId: { in: interestedOptionIds } },
          })
        : Promise.resolve(0),

      // Counted directly rather than as `assigned - called`. Subtraction is
      // only right while the two share a scope, and it silently absorbs any
      // drift between them; this is the same predicate the All Leads "Fresh"
      // tab uses (`feedbacks: none`), so the card and the page it links to
      // cannot disagree.
      prisma.lead.count({
        where: { ...approvedBase, assignedToId: { not: null }, feedbacks: { none: {} } },
      }),

      // Applications and Admissions are APPROVED RECEIPTS — money confirmed,
      // not a counsellor's claim. Scoped by the lead being in the selected
      // window rather than by the date paid, so this card reads like every
      // other one here: "of the leads in this period, how many converted".
      // The Reports page scopes the same figure by paidDate because it answers
      // a different question ("what did the agent land this week").
      prisma.leadReceipt.count({
        where: { status: 'APPROVED', type: 'APPLICATION', lead: approvedBase },
      }),
      prisma.leadReceipt.count({
        where: { status: 'APPROVED', type: 'ADMISSION', lead: approvedBase },
      }),

      // Leads by their CURRENT feedback, the same rule the All Leads pills use,
      // so clicking a card lands on the identical set.
      connectedOptionIds.length > 0
        ? prisma.lead.count({
            where: { ...approvedBase, currentFeedbackOptionId: { in: connectedOptionIds } },
          })
        : Promise.resolve(0),
      hotOptionId
        ? prisma.lead.count({ where: { ...approvedBase, currentFeedbackOptionId: hotOptionId } })
        : Promise.resolve(0),
      warmOptionId
        ? prisma.lead.count({ where: { ...approvedBase, currentFeedbackOptionId: warmOptionId } })
        : Promise.resolve(0),

      // Talk time is the one figure the window means something different for:
      // every other card counts leads CREATED in the range, but a call has its
      // own clock, so this is calls PLACED in the range. Labelled on the card.
      prisma.callLog.aggregate({
        where: {
          talkTimeSeconds: { gt: 0 },
          ...(effectiveTeamId ? { agent: { teamId: effectiveTeamId } } : {}),
          ...(from && to ? { startedAt: { gte: istStartOfDay(from), lte: istEndOfDay(to) } } : {}),
        },
        _sum: { talkTimeSeconds: true },
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
      WHERE "createdAt" >= ${toUtcSqlTimestamp(timelineFrom)}::timestamp
        AND "createdAt" <= ${toUtcSqlTimestamp(timelineTo)}::timestamp
      ${timelineTeamSql}
      GROUP BY 1
      ORDER BY 1
    `;

    const unassigned = Math.max(0, approved - assigned);


    // groupBy returns ids; resolve labels (including any since-deactivated
    // option that still has leads sitting on it, so the parts still add up).
    const distIds = feedbackDist
      .map((f) => f.currentFeedbackOptionId)
      .filter((id): id is string => id !== null);
    const distOptions = distIds.length
      ? await prisma.feedbackOption.findMany({
          where: { id: { in: distIds } },
          select: { id: true, label: true, sortOrder: true },
        })
      : [];
    const distMap = new Map(distOptions.map((o) => [o.id, o]));

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
        applications,
        admissions,
        connectedLeads,
        hotLeads,
        warmLeads,
        // Whole minutes, floored: a card reading "60 min" should not be 59m31s.
        talktimeMinutes: Math.floor((talktimeSeconds._sum.talkTimeSeconds ?? 0) / 60),
      },
      // Everything the cards need to build an All Leads link that lands on
      // exactly the rows the number counted.
      links: { connectedCategoryId, hotOptionId, warmOptionId },
      feedbackDistribution: feedbackDist
        .filter((f) => f._count.id > 0)
        .map((f) => ({
          label: distMap.get(f.currentFeedbackOptionId!)?.label ?? 'Unknown',
          count: f._count.id,
          sortOrder: distMap.get(f.currentFeedbackOptionId!)?.sortOrder ?? 0,
        }))
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ label, count }) => ({ label, count })),
      timeline: timelineRaw.map((r) => ({
        date: r.date,
        count: Number(r.count),
      })),
      // teamLeadId travels with the team so a card can hand All Leads a filter
      // it actually has: this page narrows on Lead.teamId, All Leads narrows on
      // the team's leader. No TL leads two teams, so the translation is exact.
      teams: teamStats.map((t) => ({
        id: t.id, name: t.name, teamLeadId: t.teamLeadId, leads: t._count.leads,
      })),
    });
  } catch (err) {
    console.error('[analytics/summary]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
