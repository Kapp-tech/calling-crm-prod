import { Prisma, PrismaClient } from '@prisma/client';
import { istStartOfDay, istEndOfDay, istDayKey, istShiftDays, toUtcSqlTimestamp } from './ist-time';

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

  // "Connected" / "Not Connected" are categories an admin maintains, so the
  // split follows their configuration rather than hardcoded option labels.
  const categories = await db.feedbackCategory.findMany({ select: { id: true, name: true } });
  const catId = (n: string) => categories.find((c) => c.name.toLowerCase() === n.toLowerCase())?.id;
  const connectedId = catId('Connected');
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
          FROM "LeadFeedback" f
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
               count(*) FILTER (WHERE "categoryId" = ${connectedId ?? ''})     AS "connected",
               count(*) FILTER (WHERE "categoryId" = ${notConnectedId ?? ''})  AS "notConnected"
        FROM latest
        GROUP BY 1
      `,
    ),
    // Receipts belong to the agent the lead is assigned to, counted by the date
    // the student paid rather than when it was approved — approval can lag by
    // days and would otherwise land the credit in the wrong period.
    db.leadReceipt.findMany({
      where: {
        status: 'APPROVED',
        ...(period ? { paidDate: period } : {}),
        lead: { assignedToId: { in: ids } },
      },
      select: { type: true, lead: { select: { assignedToId: true } } },
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
    const aid = r.lead.assignedToId;
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
