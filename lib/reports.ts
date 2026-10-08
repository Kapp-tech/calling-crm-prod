import { Prisma, PrismaClient } from '@prisma/client';
import { istStartOfDay, istEndOfDay, istDayKey, istShiftDays, toUtcSqlTimestamp } from './ist-time';
import { FEEDBACK_HISTORY } from './feedback-history';
import { NO_COLLEGE_LABEL } from './college-attributes';

/**
 * Agent performance reporting.
 *
 * Every figure comes from data the CRM already records. Where a column in the
 * spec has no source it returns null, so the page can show a gap — a zero would
 * read as "this agent did nothing", which is a different and unfair claim.
 *
 * Deliberately no revenue: `LeadReceipt.amountPaid` is what the *student* paid
 * the college, not what the business earns, and the per-application and
 * per-admission costing is not known here. Summing it would put an
 * authoritative-looking rupee figure on the page that nobody could act on.
 */

export type ReportRange = 'DATEWISE' | 'WEEKLY' | 'OVERALL';

/**
 * The window a report covers.
 *
 * DATEWISE takes an explicit from/to (defaulting to today), WEEKLY is the
 * current Monday–Sunday week, OVERALL is unbounded. All boundaries are IST
 * calendar days, matching every other date in the CRM.
 */
export function reportRange(
  range: ReportRange,
  from?: string | null,
  to?: string | null,
  now = new Date(),
): { from: Date | null; to: Date | null; label: string } {
  if (range === 'OVERALL') return { from: null, to: null, label: 'Overall' };

  if (range === 'WEEKLY') {
    const todayKey = istDayKey(now);
    const dow = new Date(`${todayKey}T00:00:00.000Z`).getUTCDay(); // 0=Sun
    const monday = istShiftDays(todayKey, -(dow === 0 ? 6 : dow - 1));
    return {
      from: istStartOfDay(monday),
      to: istEndOfDay(istShiftDays(monday, 6)),
      label: `Week of ${monday}`,
    };
  }

  const f = from || istDayKey(now);
  const t = to || f;
  return { from: istStartOfDay(f), to: istEndOfDay(t), label: f === t ? f : `${f} → ${t}` };
}

/** Only applies the bound when there is one, so OVERALL stays unfiltered. */
function within(from: Date | null, to: Date | null) {
  if (!from && !to) return undefined;
  return { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
}

export interface AgentReportRow {
  id: string;
  employeeCode: string | null;
  name: string;
  tl: string | null;
  manager: string | null;
  zone: string | null;
  language: string | null;
  /** ISO date. How long someone has been in the seat is the context a manager
   *  reads a new joiner's numbers against. */
  joiningDate: string | null;
  dialedCalls: number;
  connectedCalls: number;
  notConnectedCalls: number;
  applications: number;
  admissions: number;
  /**
   * Average minutes per answered call, from the dialer's post-call webhook.
   * Still null when the dialer has reported nothing for this agent in the
   * window — a gap, not a zero.
   */
  avgTalktimeMin: number | null;
}

/**
 * One row per agent for the chosen window.
 *
 * Counts are gathered with grouped queries rather than a query per agent, so a
 * team of fifty is a handful of round trips instead of hundreds.
 */
export async function buildAgentReport(
  db: PrismaClient,
  agentWhere: Prisma.UserWhereInput,
  range: ReportRange,
  from?: string | null,
  to?: string | null,
  now = new Date(),
): Promise<{ rows: AgentReportRow[]; label: string }> {
  const window = reportRange(range, from, to, now);
  const period = within(window.from, window.to);

  const agents = await db.user.findMany({
    where: agentWhere,
    select: {
      id: true, name: true, employeeCode: true, zone: true, language: true, joiningDate: true,
      managedBy: { select: { name: true } },
      team: { select: { teamLead: { select: { name: true } } } },
      manager: { select: { name: true } },
    },
    orderBy: { name: 'asc' },
  });
  const ids = agents.map((a) => a.id);
  if (ids.length === 0) return { rows: [], label: window.label };

  /**
   * THE CONNECTED / NOT CONNECTED SPLIT — read this before changing it.
   *
   * A lead is Not Connected when its latest feedback sits in the "Not
   * Connected" category, or when that feedback carries no category at all.
   * Everything else is Connected. Those two are exhaustive, so
   * Connected + Not Connected = Dialed on every row, always.
   *
   * It used to match the "Connected" category by id and count everything else
   * as a third "Other" bucket. That was wrong twice over. Categories are not
   * just a reachability flag — an admin has also made Hot, Warm and Cold — so
   * outcomes like "Call Back" (Warm) and "Not Interested" (Cold) landed in
   * Other despite obviously being conversations that happened. And it produced
   * rows reading "Dialed 2, Connected 0, Not Connected 0, Other 2", which is
   * not a defensible thing to put in front of management.
   *
   * Connected therefore requires positive evidence of contact: a category that
   * is not "Not Connected". No category at all is not evidence, so it counts as
   * Not Connected — the direction that never flatters the figure. Those
   * outcomes are named in the report footnote so the gap gets fixed in Manage
   * Feedbacks rather than quietly skewing a number.
   */
  const categories = await db.feedbackCategory.findMany({ select: { id: true, name: true } });
  const catId = (n: string) => categories.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id;
  const notConnectedId = catId('Not Connected');

  const [callCounts, receipts, talktime] = await Promise.all([
    /**
     * Dialed / Connected / Not Connected, counted as LEADS rather than as
     * follow-ups.
     *
     * An agent who rings a student, gets no answer, logs it, and reaches them
     * a minute later has worked one lead — not two. Counting follow-up rows
     * inflated a normal day by a few per cent and the worst observed agent-day
     * by 13%, which matters because these figures are scored against targets.
     * The Dialed Calls KPI counts leads for the same reason.
     *
     * The category split uses each agent's LAST follow-up on that lead inside
     * the window. That is the same rule the All Leads pills follow (they read
     * Lead.currentFeedbackOptionId, the latest feedback), so the two pages
     * agree — and it keeps the row adding up: a lead counted once under Dialed
     * lands in exactly one of the two category columns, never both. Counting
     * "any Connected follow-up" instead would double-count the leads that were
     * missed and then reached, and the columns would overshoot the total.
     *
     * Raw SQL because Prisma cannot count DISTINCT on a column. The
     * alternative — grouping by (agentId, leadId) and counting in JS — would
     * pull one row per agent-lead pair, which on OVERALL is every follow-up
     * relationship in the database.
     */
    db.$queryRaw<{ agentId: string; dialed: bigint; connected: bigint; notConnected: bigint }[]>(
      Prisma.sql`
        WITH latest AS (
          SELECT DISTINCT ON (f."agentId", f."leadId") f."agentId", fo."categoryId"
          FROM ${FEEDBACK_HISTORY} f
          LEFT JOIN "FeedbackOption" fo ON fo.id = f."feedbackOptionId"
          WHERE f."agentId" IN (${Prisma.join(ids)})
            ${
              // Explicit UTC literals, never a JS Date: the driver serialises a
              // Date in the Node process's timezone, and casting that to
              // `timestamp without time zone` drops the offset — which on the
              // UTC server would shift every report window by 5h30m.
              window.from
                ? Prisma.sql`AND f."createdAt" >= ${toUtcSqlTimestamp(window.from)}::timestamp`
                : Prisma.empty
            }
            ${
              window.to
                ? Prisma.sql`AND f."createdAt" <= ${toUtcSqlTimestamp(window.to)}::timestamp`
                : Prisma.empty
            }
          ORDER BY f."agentId", f."leadId", f."createdAt" DESC
        )
        SELECT "agentId",
               count(*)                                                       AS "dialed",
               count(*) FILTER (
                 WHERE "categoryId" IS NOT NULL
                   AND "categoryId" <> ${notConnectedId ?? ''}
               )                                                              AS "connected",
               count(*) FILTER (
                 WHERE "categoryId" IS NULL
                    OR "categoryId" = ${notConnectedId ?? ''}
               )                                                              AS "notConnected"
        FROM latest
        GROUP BY 1
      `,
    ),
    // Receipts belong to the agent who UPLOADED them, counted by the date the
    // student paid rather than when it was approved — approval can lag by days
    // and would otherwise land the credit in the wrong period.
    //
    // Deliberately not the lead's current assignee: that moves the credit every
    // time a lead is reassigned, which is routine, and rewrites past periods.
    // Kept in step with RECEIPT_COUNT in lib/kpi.ts so the Caller-wise report
    // and the KPI screen cannot disagree about the same agent.
    db.leadReceipt.findMany({
      where: {
        status: 'APPROVED',
        ...(period ? { paidDate: period } : {}),
        uploadedById: { in: ids },
      },
      select: { type: true, uploadedById: true },
    }),
    // Talk time comes from the dialer's post-call webhook. Only calls the dialer
    // itself marked CONNECTED are averaged — it reports a few seconds of "talk
    // time" on calls that never got through, so averaging everything would drag
    // each agent toward zero and make a busy day look like a quiet one.
    db.callLog.groupBy({
      by: ['agentId'],
      where: {
        agentId: { in: ids },
        connected: true,
        talkTimeSeconds: { gt: 0 },
        ...(period ? { startedAt: period } : {}),
      },
      _avg: { talkTimeSeconds: true },
    }),
  ]);

  // One decimal is enough to compare agents without implying second-level
  // precision the dialer's MM:SS strings do not carry.
  const talktimeBy = new Map<string, number>();
  for (const row of talktime as { agentId: string | null; _avg: { talkTimeSeconds: number | null } }[]) {
    const seconds = row._avg.talkTimeSeconds;
    if (row.agentId && seconds != null) {
      talktimeBy.set(row.agentId, Math.round((seconds / 60) * 10) / 10);
    }
  }

  // count() comes back as bigint over the wire; Number is safe here because a
  // lead count cannot approach 2^53.
  const dialedBy        = new Map(callCounts.map((r) => [r.agentId, Number(r.dialed)]));
  const connectedBy     = new Map(callCounts.map((r) => [r.agentId, Number(r.connected)]));
  const notConnectedBy  = new Map(callCounts.map((r) => [r.agentId, Number(r.notConnected)]));

  const appsBy = new Map<string, number>();
  const admsBy = new Map<string, number>();
  for (const r of receipts) {
    const aid = r.uploadedById;
    if (!aid) continue;
    const m = r.type === 'APPLICATION' ? appsBy : admsBy;
    m.set(aid, (m.get(aid) ?? 0) + 1);
  }

  const rows: AgentReportRow[] = agents.map((a) => {
    return {
      id: a.id,
      employeeCode: a.employeeCode,
      name: a.name,
      // A TL can be set either way round in this CRM; prefer the explicit
      // manager link and fall back to the team's lead.
      tl: a.managedBy?.name ?? a.team?.teamLead?.name ?? null,
      manager: a.manager?.name ?? null,
      zone: a.zone,
      language: a.language,
      joiningDate: a.joiningDate ? istDayKey(a.joiningDate) : null,
      dialedCalls: dialedBy.get(a.id) ?? 0,
      connectedCalls: connectedBy.get(a.id) ?? 0,
      notConnectedCalls: notConnectedBy.get(a.id) ?? 0,
      applications: appsBy.get(a.id) ?? 0,
      admissions: admsBy.get(a.id) ?? 0,
      avgTalktimeMin: talktimeBy.get(a.id) ?? null,
    };
  });

  return { rows, label: window.label };
}

/** The team-summary block on the TL and Manager dashboards. */
export function summariseAgentRows(rows: AgentReportRow[]) {
  const sum = (f: (r: AgentReportRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  return {
    totalAgents: rows.length,
    dialedCalls: sum((r) => r.dialedCalls),
    connectedCalls: sum((r) => r.connectedCalls),
    notConnectedCalls: sum((r) => r.notConnectedCalls),
    applications: sum((r) => r.applications),
    admissions: sum((r) => r.admissions),
  };
}

// ─── Feedback summary ────────────────────────────────────────────────────────

export interface FeedbackBreakdownRow {
  feedback: string;
  /** The admin-maintained category, for colouring. Null if the option has none. */
  category: string | null;
  leads: number;
}

export interface FeedbackBreakdown {
  /** Distinct colleges among the leads counted below. */
  universities: number;
  /**
   * Agents who logged at least one follow-up in the window — "who was actually
   * working that day", not the size of the roster. It is the number that makes
   * the total legible: 4,261 leads means one thing across 14 people and quite
   * another across 6.
   */
  teamMembers: number;
  total: number;
  rows: FeedbackBreakdownRow[];
  label: string;
}

/**
 * How the leads worked in the window ended up — one row per outcome.
 *
 * Counts LEADS, not follow-ups, and places each lead under its **latest**
 * follow-up in the window. That is the same latest-wins rule the All Leads
 * pills and the Dialed/Connected columns use, and it is what makes the table
 * add up: every lead appears exactly once, so the Total is the number of leads
 * worked rather than a sum that overshoots it. Counting follow-ups instead
 * would list a lead under both Hot and Warm if the agent changed their mind.
 *
 * Outcomes with no leads are simply absent — the grouping only returns what
 * happened, so there is nothing to filter out.
 */
export async function buildFeedbackBreakdown(
  db: PrismaClient,
  agentWhere: Prisma.UserWhereInput,
  range: ReportRange,
  from?: string | null,
  to?: string | null,
  now = new Date(),
  // Optional and last, so the scheduled email reports keep calling this
  // unchanged. Omitted means every college, which is what they want.
  colleges?: string[],
): Promise<FeedbackBreakdown> {
  const window = reportRange(range, from, to, now);
  const agents = await db.user.findMany({ where: agentWhere, select: { id: true } });
  const ids = agents.map((a) => a.id);
  if (ids.length === 0) {
    return { universities: 0, teamMembers: 0, total: 0, rows: [], label: window.label };
  }

  // Shared by both queries below so the two can never drift apart on which
  // leads they are talking about. Explicit UTC literals, never a JS Date — see
  // toUtcSqlTimestamp; a Date would be read in the process timezone and shift
  // the window by 5h30m on the UTC server.
  const latest = Prisma.sql`
    SELECT DISTINCT ON (f."leadId") f."leadId", f."feedbackOptionId"
    FROM ${FEEDBACK_HISTORY} f
    WHERE f."agentId" IN (${Prisma.join(ids)})
      ${window.from ? Prisma.sql`AND f."createdAt" >= ${toUtcSqlTimestamp(window.from)}::timestamp` : Prisma.empty}
      ${window.to ? Prisma.sql`AND f."createdAt" <= ${toUtcSqlTimestamp(window.to)}::timestamp` : Prisma.empty}
      ${collegeFilterSql(colleges)}
    ORDER BY f."leadId", f."createdAt" DESC
  `;

  const [breakdown, [totals], [members]] = await Promise.all([
    db.$queryRaw<{ feedback: string | null; category: string | null; leads: bigint }[]>(Prisma.sql`
      WITH latest AS (${latest})
      SELECT fo.label AS feedback, fc.name AS category, count(*)::bigint AS leads
      FROM latest l
      LEFT JOIN "FeedbackOption" fo ON fo.id = l."feedbackOptionId"
      LEFT JOIN "FeedbackCategory" fc ON fc.id = fo."categoryId"
      GROUP BY 1, 2
      ORDER BY 3 DESC, 1 ASC
    `),
    // Blank college names are excluded rather than counted as one nameless
    // university, which would quietly inflate the headline figure.
    db.$queryRaw<{ universities: bigint }[]>(Prisma.sql`
      WITH latest AS (${latest})
      SELECT count(DISTINCT ld.college)::bigint AS universities
      FROM latest l JOIN "Lead" ld ON ld.id = l."leadId"
      WHERE ld.college IS NOT NULL AND btrim(ld.college) <> ''
    `),
    // Counted off the follow-ups themselves, not the `latest` CTE: that one is
    // one row per LEAD, so an agent whose every lead was later touched by
    // someone else would vanish from it despite having worked.
    db.$queryRaw<{ members: bigint }[]>(Prisma.sql`
      SELECT count(DISTINCT f."agentId")::bigint AS members
      FROM ${FEEDBACK_HISTORY} f
      WHERE f."agentId" IN (${Prisma.join(ids)})
        ${window.from ? Prisma.sql`AND f."createdAt" >= ${toUtcSqlTimestamp(window.from)}::timestamp` : Prisma.empty}
        ${window.to ? Prisma.sql`AND f."createdAt" <= ${toUtcSqlTimestamp(window.to)}::timestamp` : Prisma.empty}
    `),
  ]);

  const rows = breakdown.map((r) => ({
    feedback: r.feedback ?? '(feedback option removed)',
    category: r.category,
    leads: Number(r.leads),
  }));

  return {
    universities: Number(totals?.universities ?? 0),
    teamMembers: Number(members?.members ?? 0),
    total: rows.reduce((sum, r) => sum + r.leads, 0),
    rows,
    label: window.label,
  };
}

// ─── College-wise breakdown ──────────────────────────────────────────────────

export interface CollegeBreakdownRow {
  college: string;
  dialed: number;
  connected: number;
  notConnected: number;
  /** Connected as a share of Dialed, whole per cent. Null when nothing was worked. */
  connectedPct: number | null;
  /** Per feedback option, keyed by label. Absent keys are zero. */
  outcomes: Record<string, number>;
}

export interface CollegeBreakdown {
  label: string;
  /**
   * Every outcome that occurred, in COLLEGE_OUTCOME_ORDER — the fixed sequence
   * the report is read in, not by volume. Unlisted outcomes come last.
   */
  availableOutcomes: string[];
  /**
   * Outcomes that occurred in this window with no feedback category set, so
   * nothing says whether the call was answered. They are counted as Not
   * Connected and named here so the report can say so rather than fold them in
   * silently. Empty on a properly configured system.
   */
  uncategorisedOutcomes: string[];
  rows: CollegeBreakdownRow[];
  totals: Omit<CollegeBreakdownRow, 'college'>;
}

/**
 * The order the University / College wise report shows outcome columns in.
 *
 * Fixed by Himanshu rather than derived from the data: the report is compared
 * week to week, and columns that reshuffle themselves by volume make that
 * impossible. It runs conversion-first (Walk-In, applications, admissions),
 * then warm interest, then the reasons a call went nowhere, then the reasons a
 * number was no good.
 *
 * These are the CRM's own labels, which differ from the sheet's in three
 * places — the sheet says "Call Back", "Call Disconnected" and "Switched Off"
 * where the CRM has `Callback`, `Call Disconnect` and `Switch Off`. Using the
 * sheet's spelling would have left those three columns empty and dropped the
 * real ones to the end.
 *
 * Matching is loose — case and punctuation are ignored — so renaming an option
 * to "Call Back" later keeps it in position instead of silently exiling it.
 * Anything not listed here still appears, at the end, most-used first: today
 * that is "Already Admission Done in same University" and "Already Application
 * Done in same University".
 */
export const COLLEGE_OUTCOME_ORDER = [
  'Walk-In',
  'Application Done',
  'Admission Done',
  'Cold',
  'Interested',
  'Hot',
  'HOT-RNR',
  'Warm',
  'Will Apply Today/Tomorrow',
  'Planning for Later',
  'Callback',
  'RNR',
  'Call Disconnect',
  'Not Intrested',
  'Not Eligible',
  'Taken Admission in Other University',
  'ICNA',
  'Switch Off',
  'Wrong Number',
  'Out of network',
  'Invalid Number',
  'Application Filled in Other University',
  'Language Barrier',
  'Budget Issue',
  'Tried 5 Time',
];

/**
 * The report's outcome columns: every listed outcome ALWAYS, in order, then any
 * unlisted one that actually occurred, most-used first.
 *
 * The listed columns appear even at zero. That is the point of a fixed
 * sequence — the sheet this replaces carries "Cold 0" and "Tried 5 Time 0", and
 * a column that vanishes on a quiet day makes two weeks impossible to compare
 * side by side. Whichever outcome names the CRM happens to hold are used, so
 * the header always reflects what the option is really called.
 */
function outcomeColumns(totals: Map<string, number>): string[] {
  /**
   * A rank can hold MORE THAN ONE label, and that is not hypothetical: this
   * database carries both `Callback` and `Call Back`, which normalise to the
   * same key. Keeping one per slot silently dropped the other's column, and its
   * leads then appeared in Dialed while belonging to no outcome — the row
   * stopped adding up. Both are kept, adjacent, in the right region.
   */
  const bySlot = new Map<number, [string, number][]>();
  const unlisted: [string, number][] = [];
  for (const [label, count] of Array.from(totals.entries())) {
    const rank = OUTCOME_RANK.get(outcomeKey(label));
    if (rank === undefined) unlisted.push([label, count]);
    else bySlot.set(rank, [...(bySlot.get(rank) ?? []), [label, count]]);
  }
  const busiestFirst = (a: [string, number], b: [string, number]) =>
    b[1] - a[1] || a[0].localeCompare(b[0]);

  const listed = COLLEGE_OUTCOME_ORDER.flatMap((canonical, i) => {
    const hits = bySlot.get(i);
    // Nothing occurred under this name — the column still appears, at zero.
    if (!hits || hits.length === 0) return [canonical];
    return [...hits].sort(busiestFirst).map(([label]) => label);
  });
  return [...listed, ...[...unlisted].sort(busiestFirst).map(([label]) => label)];
}

/** Case- and punctuation-insensitive, so a rename does not reorder the report. */
const outcomeKey = (label: string) => label.toLowerCase().replace(/[^a-z0-9]/g, '');

const OUTCOME_RANK = new Map(COLLEGE_OUTCOME_ORDER.map((l, i) => [outcomeKey(l), i]));

/** Leads carrying no college at all still have to appear, or this table's Dialed
 *  column would not add up to the feedback summary's Total. */
const NO_COLLEGE = NO_COLLEGE_LABEL;

/**
 * Restrict a feedback row to particular colleges, as an EXISTS on the lead.
 *
 * EXISTS rather than a JOIN so it can be dropped into a CTE without changing
 * the row shape — the CTE is DISTINCT ON (leadId) and a join risks disturbing
 * that. A lead has exactly one college, so EXISTS cannot duplicate rows.
 *
 * Matched trimmed and lower-cased, the same rule collegeLeadFields uses, since
 * `Lead.college` is free text arriving from uploads and the API: "LPU " and
 * "lpu" must both match the curated "LPU".
 *
 * NO_COLLEGE is selectable and means what the report already displays for a
 * lead with nothing set — null or blank. Without it a filtered report could
 * never account for those leads, and the college table's Dialed total would
 * stop reconciling with the feedback summary.
 *
 * An empty list is NOT "match nothing" — it is "no filter", which is what an
 * untouched control means.
 */
function collegeFilterSql(colleges: string[] | undefined) {
  if (!colleges || colleges.length === 0) return Prisma.empty;

  const wantsUnset = colleges.some((c) => c === NO_COLLEGE);
  const named = colleges.filter((c) => c !== NO_COLLEGE).map((c) => c.trim().toLowerCase());

  const conds: Prisma.Sql[] = [];
  if (named.length > 0) {
    conds.push(Prisma.sql`lower(btrim(ld.college)) IN (${Prisma.join(named)})`);
  }
  if (wantsUnset) {
    conds.push(Prisma.sql`(ld.college IS NULL OR btrim(ld.college) = '')`);
  }
  // Only NO_COLLEGE-less junk was passed — match nothing rather than silently
  // widening to everything.
  if (conds.length === 0) return Prisma.sql`AND false`;

  return Prisma.sql`AND EXISTS (
    SELECT 1 FROM "Lead" ld
    WHERE ld.id = f."leadId" AND (${Prisma.join(conds, ' OR ')})
  )`;
}

/**
 * The same book of work as the feedback summary, split by college instead of by
 * outcome.
 *
 * Identical counting rule — one lead, once, under its latest follow-up in the
 * window — so the Dialed column totals to exactly the same number the feedback
 * summary reports. Connected and Not Connected are exhaustive, so they add back
 * to Dialed on every row; there is no third bucket and no way for a row to fail
 * to add up. Two tables from one definition rather than two that drift.
 */
export async function buildCollegeBreakdown(
  db: PrismaClient,
  agentWhere: Prisma.UserWhereInput,
  range: ReportRange,
  from?: string | null,
  to?: string | null,
  now = new Date(),
  // Same filter as buildFeedbackBreakdown, applied in the same place, so the
  // college table's Dialed total still reconciles with the summary's Total.
  colleges?: string[],
): Promise<CollegeBreakdown> {
  const window = reportRange(range, from, to, now);
  const empty: CollegeBreakdown = {
    label: window.label,
    availableOutcomes: [],
    uncategorisedOutcomes: [],
    rows: [],
    totals: { dialed: 0, connected: 0, notConnected: 0, connectedPct: null, outcomes: {} },
  };

  const agents = await db.user.findMany({ where: agentWhere, select: { id: true } });
  const ids = agents.map((a) => a.id);
  if (ids.length === 0) return empty;

  const raw = await db.$queryRaw<
    { college: string | null; feedback: string | null; category: string | null; leads: bigint }[]
  >(Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (f."leadId") f."leadId", f."feedbackOptionId"
      FROM ${FEEDBACK_HISTORY} f
      WHERE f."agentId" IN (${Prisma.join(ids)})
        ${window.from ? Prisma.sql`AND f."createdAt" >= ${toUtcSqlTimestamp(window.from)}::timestamp` : Prisma.empty}
        ${window.to ? Prisma.sql`AND f."createdAt" <= ${toUtcSqlTimestamp(window.to)}::timestamp` : Prisma.empty}
        ${collegeFilterSql(colleges)}
      ORDER BY f."leadId", f."createdAt" DESC
    )
    SELECT nullif(btrim(ld.college), '') AS college,
           fo.label AS feedback,
           fc.name  AS category,
           count(*)::bigint AS leads
    FROM latest l
    JOIN "Lead" ld ON ld.id = l."leadId"
    LEFT JOIN "FeedbackOption" fo ON fo.id = l."feedbackOptionId"
    LEFT JOIN "FeedbackCategory" fc ON fc.id = fo."categoryId"
    GROUP BY 1, 2, 3
  `);
  if (raw.length === 0) return empty;

  const byCollege = new Map<string, CollegeBreakdownRow>();
  const outcomeTotals = new Map<string, number>();
  const uncategorised = new Set<string>();

  for (const r of raw) {
    const college = r.college ?? NO_COLLEGE;
    const label = r.feedback ?? '(feedback option removed)';
    const n = Number(r.leads);

    let row = byCollege.get(college);
    if (!row) {
      row = { college, dialed: 0, connected: 0, notConnected: 0, connectedPct: null, outcomes: {} };
      byCollege.set(college, row);
    }
    row.dialed += n;
    // The same rule buildAgentReport uses — see the long note there. Not
    // Connected is the category, matched case-insensitively so a rename to
    // "not connected" still lands right; no category at all is not evidence of
    // contact, so it counts as not connected too. Exhaustive by construction,
    // which is what makes the row add up.
    const cat = (r.category ?? '').trim().toLowerCase();
    if (cat === '') uncategorised.add(label);
    if (cat === '' || cat === 'not connected') row.notConnected += n;
    else row.connected += n;
    row.outcomes[label] = (row.outcomes[label] ?? 0) + n;
    outcomeTotals.set(label, (outcomeTotals.get(label) ?? 0) + n);
  }

  const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

  const rows = Array.from(byCollege.values())
    .map((r) => ({ ...r, connectedPct: pct(r.connected, r.dialed) }))
    .sort((a, b) => b.dialed - a.dialed || a.college.localeCompare(b.college));

  const totals = rows.reduce(
    (acc, r) => {
      acc.dialed += r.dialed;
      acc.connected += r.connected;
      acc.notConnected += r.notConnected;
      for (const [k, v] of Object.entries(r.outcomes)) acc.outcomes[k] = (acc.outcomes[k] ?? 0) + v;
      return acc;
    },
    { dialed: 0, connected: 0, notConnected: 0, connectedPct: null as number | null, outcomes: {} as Record<string, number> },
  );
  totals.connectedPct = pct(totals.connected, totals.dialed);

  return {
    label: window.label,
    availableOutcomes: outcomeColumns(outcomeTotals),
    uncategorisedOutcomes: Array.from(uncategorised).sort((a, b) => a.localeCompare(b)),
    rows,
    totals,
  };
}


/**
 * Active time a check-in must carry before it counts as a day at work on its
 * own. See `activeDaysByAgent` — an hour sits far above the sub-10-minute
 * logins that are the only check-ins with no work behind them, and far below
 * the ~6-hour median of a real shift.
 */
const REAL_SHIFT_ACTIVE_SECONDS = 60 * 60;

/**
 * IST days on which each agent actually did calling work in the window.
 *
 * A day counts if the agent logged a follow-up OR the dialer recorded a call
 * they actually made or took. Both signals are needed: an agent can have days
 * with call logs and no follow-ups, because dialling a lead and leaving no
 * feedback is a real and common thing.
 *
 * ─── A check-in counts only if it was a real shift ──────────────────────────
 *
 * Turning up and producing nothing is still a day at work, and it is the day a
 * manager most wants a target against. Recorded work alone would let that agent
 * off with no target at all. Check-in cannot be the ONLY signal either: of the
 * 239 days with real work here, 78 carry no check-in, because check-in only
 * began on 4 Aug 2026 and was skipped for weeks before the attendance gate.
 *
 * But a bare check-in is not a shift, and counting one did real damage. Every
 * single check-in-with-no-work day on this database — all 7 of them — is a
 * sub-10-minute login from attendance's first ten days: people opening the new
 * feature to see what it did. Median active time 1 minute, maximum 7. Counting
 * those as working days took Kamaleswar Ghosh's Overall achievement from 91% to
 * 68% on the strength of a five-minute session on 5 August, which is a day he
 * never worked.
 *
 * So a check-in has to carry a real shift's worth of active time. The gap is
 * wide and unambiguous: days with actual work run to a median of 353 active
 * minutes and a maximum of 449, while the seven junk days top out at 7. An hour
 * sits far above the noise and far below any real shift.
 *
 * Note this gates the check-in signal ONLY. A genuine working day with no
 * recorded heartbeat — the CRM tab closed while the agent works the dialer —
 * still counts through the work branches, which is why days with real work show
 * a minimum of 0 active minutes and are unaffected by it.
 *
 * ─── Unanswered inbound calls are NOT work ──────────────────────────────────
 *
 * A missed call is a phone ringing at an empty desk, and the first version of
 * this counted it as a day worked. On 4 Sept Shivam Rajput was absent and never
 * checked in, yet the Caller-wise report gave him a full 300-call target while
 * the other two absentees correctly got zero. The difference was 22 CallLog
 * rows — every one `callType = 'inbound'`, campaign `sticky100205`, zero
 * talktime, zero answered. They were calls that arrived FOR his sticky seat
 * while he was away, not calls he made.
 *
 * So an inbound call only counts when it was actually answered. Across the
 * whole database every one of the 1,887 inbound rows has zero talktime — in
 * this dialer, inbound means missed — but the talktime clause stays so that an
 * answered inbound would count if that ever changes. Outbound always counts,
 * answered or not: placing the call is the work.
 *
 * This replaced a version that counted Attendance check-ins ALONE, which cannot
 * carry the column or the denominator on its own. Check-in only started on 4 Aug
 * 2026 and was skipped on most days until the attendance gate shipped: Yash
 * Sharma has 10 check-ins against 25 days of recorded calling. Dividing a
 * lifetime of work by 10 days of mandate scores him at 167%; dividing by the
 * 25 days he actually worked scores him at 61%. Going forward the gate makes
 * the two converge, since an agent can no longer call without checking in.
 *
 * UNION, not UNION ALL: an agent normally has both a follow-up and a call log
 * on the same day, and that is one day worked, not two.
 */
export async function activeDaysByAgent(
  db: PrismaClient,
  userIds: string[],
  from: Date | null,
  to: Date | null,
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  // Explicit UTC literals, never a JS Date — see toUtcSqlTimestamp.
  const rows = await db.$queryRaw<{ agentId: string; days: number }[]>(Prisma.sql`
    SELECT "agentId", count(*)::int AS "days"
    FROM (
      SELECT f."agentId" AS "agentId",
             to_char(f."createdAt" + interval '5 hours 30 minutes', 'YYYY-MM-DD') AS "day"
      FROM ${FEEDBACK_HISTORY} f
      WHERE f."agentId" IN (${Prisma.join(userIds)})
        ${from ? Prisma.sql`AND f."createdAt" >= ${toUtcSqlTimestamp(from)}::timestamp` : Prisma.empty}
        ${to ? Prisma.sql`AND f."createdAt" <= ${toUtcSqlTimestamp(to)}::timestamp` : Prisma.empty}
      UNION
      SELECT c."agentId" AS "agentId",
             to_char(c."startedAt" + interval '5 hours 30 minutes', 'YYYY-MM-DD') AS "day"
      FROM "CallLog" c
      WHERE c."agentId" IN (${Prisma.join(userIds)})
        AND (
          lower(coalesce(c."callType", '')) <> 'inbound'
          OR coalesce(c."talkTimeSeconds", 0) > 0
        )
        ${from ? Prisma.sql`AND c."startedAt" >= ${toUtcSqlTimestamp(from)}::timestamp` : Prisma.empty}
        ${to ? Prisma.sql`AND c."startedAt" <= ${toUtcSqlTimestamp(to)}::timestamp` : Prisma.empty}
      UNION
      -- Attendance.date is already the IST day key as a plain string, so it
      -- joins the other two branches with no timezone arithmetic at all.
      SELECT a."userId" AS "agentId", a."date" AS "day"
      FROM "Attendance" a
      WHERE a."userId" IN (${Prisma.join(userIds)})
        AND a."activeSeconds" >= ${REAL_SHIFT_ACTIVE_SECONDS}
        ${from ? Prisma.sql`AND a."date" >= ${istDayKey(from)}` : Prisma.empty}
        ${to ? Prisma.sql`AND a."date" <= ${istDayKey(to)}` : Prisma.empty}
    ) d
    GROUP BY "agentId"
  `);
  return new Map(rows.map((r) => [r.agentId, Number(r.days)]));
}

// ─── Overall Calling Report ──────────────────────────────────────────────────

export interface CallingRow {
  name: string;
  employeeCode: string | null;
  /** ISO date. Context a manager reads a new joiner's numbers against. */
  joiningDate: string | null;
  /**
   * Days this agent actually did calling work inside the window — a follow-up
   * or a dialer call, not calendar days and NOT check-ins. See
   * `activeDaysByAgent` for why check-ins cannot carry this column.
   */
  workingDays: number;
  dialed: number;
  connected: number;
  /** Total dialer minutes, the same figure the Talktime KPI reports. */
  talktimeMin: number;
}

export interface CallingBlock {
  key: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'OVERALL';
  label: string;
  /** Letter used by the block's total row; Overall has none. */
  letter: string | null;
  from: string | null;
  to: string | null;
  /**
   * IST days the window covers so far — 1 for today, Monday-to-today for the
   * week, the 1st-to-today for the month. Counting elapsed days rather than
   * whole ones is what stops a Wednesday being measured against a full week.
   * Null for Overall, which is unbounded and so has no calendar day count. A
   * row in that block is measured against its own agent's worked days instead.
   */
  days: number | null;
  rows: CallingRow[];
  /** Every agent in scope, whether or not they worked in this window. */
  employees: number;
  /**
   * Agents who dialled at least one lead in this window.
   *
   * This is the denominator basis for the floor-level percentages: a mandate is
   * per agent per day, so the floor's target is mandate x days x people. Using
   * the people who actually worked is what stops a day when half the team is on
   * leave from reading as a collapse — and it is why the summary puts this
   * column immediately before the figures it explains.
   */
  activeEmployees: number;
  /**
   * Agent-days the block's TOTAL row is measured against: target =
   * mandate x agentDays.
   *
   * For a bounded window that is simply days x active people. Overall has no
   * day count, so it is the sum of each agent's own worked days — which is the
   * same arithmetic, just with a different number of days per person.
   */
  agentDays: number;
  totals: { dialed: number; connected: number; talktimeMin: number };
}

export interface OverallCallingReport {
  dateLabel: string;
  /** Per-day expectations, read from the KPI Targets page's daily targets. */
  mandates: { dialed: number | null; connected: number | null; talktime: number | null };
  blocks: CallingBlock[];
  // No grand total. That row added Daily + Weekly + Monthly, windows which
  // overlap, so it was never a count of distinct work — Himanshu dropped it.
}

/**
 * The Overall Calling Report: the same agents in four windows — today, this
 * week so far, this month so far, and all time — against the daily mandate.
 *
 * Dialled and Connected come from `buildAgentReport`, so they carry the same
 * leads-not-follow-ups counting and the same exhaustive Connected split as
 * every other report here. Talktime is the dialer's own total, matching the
 * Talktime KPI's `CALL_TALKTIME_MINUTES` rather than the *average* per call
 * that the agent tables show — a mandate of "180 mins" is plainly a daily
 * total, and a second definition of talktime is how two reports start
 * disagreeing.
 *
 * The mandates are read from KPI Targets rather than stored again here. One
 * place to change an expectation; change it there and this report follows.
 */
export async function buildOverallCallingReport(
  db: PrismaClient,
  agentWhere: Prisma.UserWhereInput,
  now = new Date(),
): Promise<OverallCallingReport> {
  const todayKey = istDayKey(now);
  const dow = new Date(`${todayKey}T00:00:00.000Z`).getUTCDay(); // 0 = Sun
  const monday = istShiftDays(todayKey, -(dow === 0 ? 6 : dow - 1));
  const monthFirst = `${todayKey.slice(0, 8)}01`;
  const dayOfMonth = Number(todayKey.slice(8, 10));

  const defs = await db.kpiDefinition.findMany({
    select: { name: true, source: true, targets: { where: { period: 'DAILY' }, select: { target: true } } },
  });
  const byName = (re: RegExp) => defs.find((d) => re.test(d.name))?.targets[0]?.target ?? null;
  const mandates = {
    dialed: byName(/dial+ed/i) ?? byName(/dial/i),
    connected: byName(/connect/i),
    // Matched by source first: it is unambiguous where a name is not.
    talktime:
      defs.find((d) => d.source === 'CALL_TALKTIME_MINUTES')?.targets[0]?.target ?? byName(/talk/i),
  };

  /**
   * Weekly is the WHOLE OF LAST WEEK, Monday to Saturday — not this week so
   * far. On a Wednesday it reports the previous Monday-to-Saturday, a settled
   * six-day window that will not move again. Sunday is excluded because the
   * floor does not work it, so counting it would divide a full week's effort by
   * seven days of mandate.
   *
   * Monthly stays the 1st to today: a month in progress is what a manager wants
   * mid-month, and it is what the sheet has always shown.
   */
  const lastMonday = istShiftDays(monday, -7);
  const lastSaturday = istShiftDays(lastMonday, 5);

  const spec: Omit<CallingBlock, 'rows' | 'totals' | 'employees' | 'activeEmployees' | 'agentDays'>[] = [
    { key: 'DAILY', label: 'Daily', letter: 'A', from: todayKey, to: todayKey, days: 1 },
    { key: 'WEEKLY', label: 'Weekly', letter: 'B', from: lastMonday, to: lastSaturday, days: 6 },
    { key: 'MONTHLY', label: 'Monthly', letter: 'C', from: monthFirst, to: todayKey, days: dayOfMonth },
    { key: 'OVERALL', label: 'Overall', letter: null, from: null, to: null, days: null },
  ];

  const agents = await db.user.findMany({
    where: agentWhere,
    select: { id: true, joiningDate: true },
  });
  const ids = agents.map((a) => a.id);
  const joinedBy = new Map(
    agents.map((a) => [a.id, a.joiningDate ? istDayKey(a.joiningDate) : null] as const),
  );

  const blocks: CallingBlock[] = [];
  for (const s of spec) {
    const { rows: agentRows } = await buildAgentReport(
      db, agentWhere, s.from ? 'DATEWISE' : 'OVERALL', s.from, s.to, now,
    );
    const window = reportRange(s.from ? 'DATEWISE' : 'OVERALL', s.from, s.to, now);
    const talk =
      ids.length === 0
        ? []
        : await db.callLog.groupBy({
            by: ['agentId'],
            where: { agentId: { in: ids }, ...(within(window.from, window.to) ? { startedAt: within(window.from, window.to) } : {}) },
            _sum: { talkTimeSeconds: true },
          });
    const talkBy = new Map<string, number>();
    for (const t of talk as { agentId: string | null; _sum: { talkTimeSeconds: number | null } }[]) {
      // Floored, exactly as the Talktime KPI does it: a 180-minute mandate
      // should not be met by 179m40s.
      if (t.agentId) talkBy.set(t.agentId, Math.floor((t._sum.talkTimeSeconds ?? 0) / 60));
    }

    // Days each agent actually worked in this window. Overall passes a null
    // window, so it counts every day they have ever recorded work on — which
    // is exactly the day count its percentages divide by.
    const workedBy = await activeDaysByAgent(db, ids, window.from, window.to);

    const rows: CallingRow[] = agentRows.map((r) => ({
      name: r.name,
      employeeCode: r.employeeCode,
      joiningDate: joinedBy.get(r.id) ?? null,
      workingDays: workedBy.get(r.id) ?? 0,
      dialed: r.dialedCalls,
      connected: r.connectedCalls,
      talktimeMin: talkBy.get(r.id) ?? 0,
    }));
    const activeEmployees = rows.filter((r) => r.dialed > 0).length;
    blocks.push({
      ...s,
      rows,
      employees: rows.length,
      activeEmployees,
      // Overall's people worked different numbers of days, so its total target
      // is the sum of theirs rather than one day count times a headcount.
      agentDays: s.days === null
        ? rows.reduce((n, r) => n + r.workingDays, 0)
        : s.days * activeEmployees,
      totals: rows.reduce(
        (acc, r) => ({
          dialed: acc.dialed + r.dialed,
          connected: acc.connected + r.connected,
          talktimeMin: acc.talktimeMin + r.talktimeMin,
        }),
        { dialed: 0, connected: 0, talktimeMin: 0 },
      ),
    });
  }

  const [yy, mm, dd] = todayKey.split('-');
  return { dateLabel: `${dd}/${mm}/${yy}`, mandates, blocks };
}
