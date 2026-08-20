import { Prisma, PrismaClient } from '@prisma/client';
import { istStartOfDay, istEndOfDay, istDayKey, istShiftDays } from './ist-time';

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
  workingDays: number;
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
      id: true, name: true, employeeCode: true, zone: true, language: true,
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

  const feedbackBase: Prisma.LeadFeedbackWhereInput = {
    agentId: { in: ids },
    ...(period ? { createdAt: period } : {}),
  };

  const [dialed, connected, notConnected, receipts, attendance, talktime] = await Promise.all([
    db.leadFeedback.groupBy({ by: ['agentId'], where: feedbackBase, _count: { _all: true } }),
    connectedId
      ? db.leadFeedback.groupBy({
          by: ['agentId'],
          where: { ...feedbackBase, feedbackOption: { categoryId: connectedId } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
    notConnectedId
      ? db.leadFeedback.groupBy({
          by: ['agentId'],
          where: { ...feedbackBase, feedbackOption: { categoryId: notConnectedId } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
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
    // A working day is a day the agent punched in at all. Attendance.date is a
    // "YYYY-MM-DD" IST string, so it is filtered as a string range rather than
    // being cast to a timestamp.
    db.attendance.findMany({
      where: {
        userId: { in: ids },
        ...(window.from && window.to
          ? { date: { gte: istDayKey(window.from), lte: istDayKey(window.to) } }
          : {}),
      },
      select: { userId: true, date: true },
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

  const num = (rows: { agentId: string; _count: { _all: number } }[]) =>
    new Map(rows.map((r) => [r.agentId, r._count._all]));
  const dialedBy = num(dialed as never);
  const connectedBy = num(connected as never);
  const notConnectedBy = num(notConnected as never);

  const appsBy = new Map<string, number>();
  const admsBy = new Map<string, number>();
  for (const r of receipts) {
    const aid = r.lead.assignedToId;
    if (!aid) continue;
    const m = r.type === 'APPLICATION' ? appsBy : admsBy;
    m.set(aid, (m.get(aid) ?? 0) + 1);
  }

  // Distinct dates — two punch-ins on one day are still one working day.
  const daysBy = new Map<string, Set<string>>();
  for (const a of attendance) {
    if (!daysBy.has(a.userId)) daysBy.set(a.userId, new Set());
    daysBy.get(a.userId)!.add(a.date);
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
      workingDays: daysBy.get(a.id)?.size ?? 0,
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
