import { KpiPeriod, KpiSource, Prisma, PrismaClient, ReceiptType } from '@prisma/client';
import { istStartOfDay, istEndOfDay, istDayKey, istShiftDays, toUtcSqlTimestamp } from './ist-time';
import { FEEDBACK_HISTORY, feedbackNarrowingSql } from './feedback-history';

/**
 * KPI evaluation.
 *
 * A KPI is a row in KpiDefinition, not a branch in code: pick a source, narrow
 * it with the definition's fields, and this file turns that into a number. That
 * means a new KPI is something an admin creates from the page, and the six the
 * system ships with are ordinary definitions they can edit or delete.
 */

export const KPI_SOURCES: {
  key: KpiSource;
  label: string;
  /** What the source counts, shown in the builder so the choice is obvious. */
  help: string;
  /** Which config fields the builder should ask for. */
  needs: ('feedback' | 'leadStages' | 'receiptType')[];
  /** A point-in-time count: the period window does not apply. */
  snapshot?: boolean;
  measurable: boolean;
}[] = [
  {
    key: 'FEEDBACK_COUNT',
    label: 'Feedback logged',
    help: 'Counts every follow-up logged in the period. Narrow it to particular feedback options or whole categories, or leave both empty to count all of them.',
    needs: ['feedback'],
    measurable: true,
  },
  {
    key: 'FEEDBACK_LEADS',
    label: 'Leads given that feedback',
    help: 'Counts each lead once however many times it was followed up, if it got that feedback at any point in the period. A later follow-up does not erase it — use this for milestones such as Admission Done.',
    needs: ['feedback'],
    measurable: true,
  },
  {
    key: 'FEEDBACK_LEADS_LATEST',
    label: 'Leads now at that feedback',
    help: 'Counts each lead once, by its latest follow-up in the period. A lead marked Hot and later moved to Warm counts as Warm only, never as both — the same rule the All Leads pills use. Use this for states such as Hot and Warm.',
    needs: ['feedback'],
    measurable: true,
  },
  {
    key: 'LEAD_STAGE_LIVE',
    label: 'Leads at a stage (live)',
    help: 'How many of the agent’s assigned leads sit at the chosen Lead Stage right now. Ignores the period — the same lead counts while it stays there.',
    needs: ['leadStages'],
    snapshot: true,
    measurable: true,
  },
  {
    key: 'RECEIPT_COUNT',
    label: 'Approved receipts',
    help: 'Approved receipts of the chosen type for the agent’s leads, counted by the date the student paid rather than when it was approved.',
    needs: ['receiptType'],
    measurable: true,
  },
  {
    key: 'LEADS_ASSIGNED',
    label: 'Leads assigned',
    help: 'Leads handed to the agent during the period.',
    needs: [],
    measurable: true,
  },
  {
    key: 'CALL_TALKTIME_MINUTES',
    label: 'Talk time (minutes)',
    help: 'Total minutes the agent actually spent talking in the period, from the dialer’s post-call webhook. Rounded down to whole minutes.',
    needs: [],
    measurable: true,
  },
  {
    key: 'CALL_COUNT',
    label: 'Calls made (dialer)',
    help: 'Every call the dialer reported for the agent in the period, answered or not. Unlike “Feedback logged”, this counts the call itself rather than the counsellor writing it up.',
    needs: [],
    measurable: true,
  },
  {
    key: 'CALL_CONNECTED_COUNT',
    label: 'Calls answered (dialer)',
    help: 'Calls the dialer marked CONNECTED. It reports unanswered calls too, sometimes with a few seconds of talk time, and those are excluded here.',
    needs: [],
    measurable: true,
  },
  {
    key: 'NOT_MEASURED',
    label: 'Not measured (target only)',
    help: 'Set a target but show no achievement. For anything the CRM genuinely cannot see.',
    needs: [],
    measurable: false,
  },
];

/**
 * What an agent has earned on one KPI.
 *
 * Proportional and capped: half the target earns half the points, and beating
 * the target earns no more than the target was worth. The cap is what keeps a
 * "max score" meaningful — without it one agent hammering a single easy KPI
 * could out-score a colleague who hit everything.
 *
 * Returns null when the KPI is not scored (no points set) or has no target to
 * measure against, so the page can show a gap rather than a misleading zero.
 * A target of 0 is treated as already met: asking for none and getting none is
 * success, not a division by zero.
 */
export function kpiScore(
  actual: number | null,
  target: number | null | undefined,
  points: number | null | undefined,
): number | null {
  if (points == null || target == null) return null;
  if (actual == null) return null;
  if (target <= 0) return points;
  const earned = (Math.min(actual, target) / target) * points;
  // One decimal: enough to separate agents without implying precision the
  // underlying counts do not have.
  return Math.round(earned * 10) / 10;
}

export const KPI_PERIODS: { key: KpiPeriod; label: string }[] = [
  { key: 'DAILY', label: 'Daily' },
  { key: 'WEEKLY', label: 'Weekly' },
  { key: 'MONTHLY', label: 'Monthly' },
  { key: 'QUARTERLY', label: 'Quarterly' },
];

/**
 * The window a period covers, anchored to IST calendar boundaries.
 *
 * Every date the CRM shows is an IST calendar day, so a "day" here must be too —
 * the server's local midnight would shift every figure by 5h30m and file
 * late-evening work under the wrong day.
 *
 * Weeks run Monday–Sunday. Quarters are calendar quarters, not the Indian
 * financial year.
 */
export function kpiPeriodRange(period: KpiPeriod, now = new Date()): { from: Date; to: Date; label: string } {
  const todayKey = istDayKey(now);

  if (period === 'DAILY') {
    return { from: istStartOfDay(todayKey), to: istEndOfDay(todayKey), label: 'Today' };
  }

  if (period === 'WEEKLY') {
    // The key is already the IST date, so its weekday is read in UTC to avoid
    // applying a second timezone shift.
    const dow = new Date(`${todayKey}T00:00:00.000Z`).getUTCDay(); // 0=Sun
    const monday = istShiftDays(todayKey, -(dow === 0 ? 6 : dow - 1));
    return { from: istStartOfDay(monday), to: istEndOfDay(istShiftDays(monday, 6)), label: 'This week' };
  }

  const [y, m] = todayKey.split('-').map(Number);

  if (period === 'MONTHLY') {
    const first = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      from: istStartOfDay(first),
      to: istEndOfDay(`${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`),
      label: 'This month',
    };
  }

  const qStart = Math.floor((m - 1) / 3) * 3 + 1;
  const qEnd = qStart + 2;
  const lastDay = new Date(Date.UTC(y, qEnd, 0)).getUTCDate();
  return {
    from: istStartOfDay(`${y}-${String(qStart).padStart(2, '0')}-01`),
    to: istEndOfDay(`${y}-${String(qEnd).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`),
    label: `Q${Math.floor((m - 1) / 3) + 1}`,
  };
}

/**
 * A snapshot source answers "how many right now" and ignores the window
 * entirely, so its target must NOT scale with the days a custom range covers —
 * multiplying "2 hot leads on your desk" by a fortnight asks for 28 and can
 * never be met.
 */
export function isSnapshotSource(source: KpiSource): boolean {
  return KPI_SOURCES.find((s) => s.key === source)?.snapshot === true;
}

/**
 * An explicit window, for when the four named periods are not what is being
 * asked for. Anything that takes a `KpiPeriod` takes one of these instead.
 */
export interface KpiWindow {
  from: Date;
  to: Date;
}

/**
 * A custom range guards against a query that scans years of follow-ups for
 * every agent and every KPI at once. A year is well past any review anyone
 * runs off this page.
 */
export const MAX_CUSTOM_RANGE_DAYS = 366;

const IST_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A range between two IST calendar dates, inclusive of both ends.
 *
 * `days` is the count of IST calendar days it spans — 1 for a single date, not
 * 0 — because it is what a per-day target gets multiplied by. It is derived
 * from the two IST midnights rather than from `to - from`, so it stays a whole
 * number instead of coming out as 6.9999 across a DST-free but float-divided
 * span.
 *
 * The dates are swapped if they arrive backwards; a range is a range.
 */
export function kpiCustomRange(fromKey: string, toKey: string): KpiWindow & { label: string; days: number } {
  const [a, b] = fromKey <= toKey ? [fromKey, toKey] : [toKey, fromKey];
  const from = istStartOfDay(a);
  const days = Math.round((istStartOfDay(b).getTime() - from.getTime()) / IST_DAY_MS) + 1;
  return { from, to: istEndOfDay(b), days, label: a === b ? istDayLabel(a) : `${istDayLabel(a)} – ${istDayLabel(b)}` };
}

/** "14 Aug 2026" — the range label reads as a date, not as an ISO key. */
function istDayLabel(dayKey: string): string {
  return new Date(`${dayKey}T00:00:00.000Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

/** The subset of a definition this evaluator needs. */
export interface KpiDefinitionLike {
  id: string;
  source: KpiSource;
  feedbackOptionIds: string[];
  feedbackCategoryIds: string[];
  leadStages: string[];
  receiptType: ReceiptType | null;
}


/**
 * One agent's achievement for one KPI in one period.
 *
 * Returns null when the definition has no source, so the caller can render a
 * gap. A zero would read as "this agent did nothing", which is a different and
 * unfair claim.
 */
export async function computeKpiActual(
  db: PrismaClient | Prisma.TransactionClient,
  def: KpiDefinitionLike,
  userId: string,
  period: KpiPeriod | KpiWindow,
  now = new Date(),
): Promise<number | null> {
  const { from, to } = typeof period === 'string' ? kpiPeriodRange(period, now) : period;
  const inPeriod = { gte: from, lte: to };

  /**
   * Both feedback sources read live AND archived follow-ups — see
   * FEEDBACK_HISTORY. Raw SQL rather than Prisma's `count`/`groupBy` because
   * the archive is a second table and Prisma cannot span the two; the union has
   * to happen in SQL. `inPeriod` is kept for the sources that still use it.
   */
  const narrowing = feedbackNarrowingSql(
    def.feedbackOptionIds,
    def.feedbackCategoryIds,
    Prisma.sql`f."feedbackOptionId"`,
    Prisma.sql`fo."categoryId"`,
  );
  const window = Prisma.sql`
    f."agentId" = ${userId}
      AND f."createdAt" >= ${toUtcSqlTimestamp(from)}::timestamp
      AND f."createdAt" <= ${toUtcSqlTimestamp(to)}::timestamp
  `;

  switch (def.source) {
    case 'FEEDBACK_COUNT': {
      const rows = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT count(*)::bigint AS count
        FROM ${FEEDBACK_HISTORY} f
        LEFT JOIN "FeedbackOption" fo ON fo.id = f."feedbackOptionId"
        WHERE ${window} AND (${narrowing})
      `);
      return Number(rows[0]?.count ?? 0);
    }

    case 'FEEDBACK_LEADS': {
      // Distinct leads rather than rows: an agent who rings a student twice has
      // worked one lead.
      const rows = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT count(DISTINCT f."leadId")::bigint AS count
        FROM ${FEEDBACK_HISTORY} f
        LEFT JOIN "FeedbackOption" fo ON fo.id = f."feedbackOptionId"
        WHERE ${window} AND (${narrowing})
      `);
      return Number(rows[0]?.count ?? 0);
    }

    case 'FEEDBACK_LEADS_LATEST': {
      /**
       * Leads whose LAST follow-up in the period matches the definition.
       *
       * The difference from FEEDBACK_LEADS is what happens after a change of
       * mind. An agent marks a lead Hot at 10:53 and downgrades it to Warm at
       * 11:43: FEEDBACK_LEADS counts it under both Hot and Warm, this counts it
       * under Warm alone. For a state like Hot or Warm the second reading is
       * the one a manager means, and it is what the All Leads pills already
       * show — they read Lead.currentFeedbackOptionId, the latest feedback.
       *
       * Raw SQL because this is a per-lead argmax, which Prisma cannot express.
       * DISTINCT ON is the cheap way to do it in Postgres.
       */
      // Narrowing is applied to the *latest* row per lead, so it names the CTE
      // columns rather than the raw feedback ones.
      const latestNarrowing = feedbackNarrowingSql(
        def.feedbackOptionIds,
        def.feedbackCategoryIds,
        Prisma.sql`l."feedbackOptionId"`,
        Prisma.sql`fo."categoryId"`,
      );

      const rows = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        WITH latest AS (
          SELECT DISTINCT ON (f."leadId") f."leadId", f."feedbackOptionId"
          FROM ${FEEDBACK_HISTORY} f
          WHERE ${window}
          ORDER BY f."leadId", f."createdAt" DESC
        )
        SELECT count(*)::bigint AS count
        FROM latest l
        LEFT JOIN "FeedbackOption" fo ON fo.id = l."feedbackOptionId"
        WHERE ${latestNarrowing}
      `);
      return Number(rows[0]?.count ?? 0);
    }

    case 'LEAD_STAGE_LIVE':
      // Snapshot — the period window is deliberately not applied.
      if (def.leadStages.length === 0) return 0;
      return db.lead.count({
        where: { assignedToId: userId, leadStage: { in: def.leadStages, mode: 'insensitive' } },
      });

    case 'RECEIPT_COUNT':
      // Credited to whoever UPLOADED the receipt, not to whoever holds the lead
      // now. Those are the same person right up until the lead is reassigned,
      // and then they are not: the old rule read the lead's current assignee,
      // so reassigning a lead moved an approved receipt's credit to an agent
      // who had nothing to do with it and took it from the one who earned it.
      // Reassignment is routine here, so this was quietly rewriting KPI history
      // — including for periods already closed and reported on.
      //
      // `uploadedById` is stamped from the session at upload time and never
      // changes afterwards, which is what makes the number stable.
      return db.leadReceipt.count({
        where: {
          status: 'APPROVED',
          ...(def.receiptType ? { type: def.receiptType } : {}),
          paidDate: inPeriod,
          uploadedById: userId,
        },
      });

    case 'LEADS_ASSIGNED':
      return db.lead.count({ where: { assignedToId: userId, assignedAt: inPeriod } });

    // The three dialer sources below are only as complete as the post-call
    // webhook. A call whose seat is not mapped to a CRM user is stored but
    // attributed to nobody, so it counts for no one rather than for everyone.
    case 'CALL_TALKTIME_MINUTES': {
      const agg = await db.callLog.aggregate({
        where: { agentId: userId, startedAt: inPeriod },
        _sum: { talkTimeSeconds: true },
      });
      // Floor, not round: a target of "60 min" should not be met by 59m31s.
      return Math.floor((agg._sum.talkTimeSeconds ?? 0) / 60);
    }

    case 'CALL_COUNT':
      return db.callLog.count({ where: { agentId: userId, startedAt: inPeriod } });

    case 'CALL_CONNECTED_COUNT':
      // The dialer's own CONNECTED verdict, not a talk-time guess — it reports
      // seconds of talk time on calls that never got through.
      return db.callLog.count({
        where: { agentId: userId, startedAt: inPeriod, connected: true },
      });

    case 'NOT_MEASURED':
    default:
      return null;
  }
}

/**
 * One agent's KPI score for a period, and the score a full house would be worth.
 *
 * `now` decides which window is measured, so passing yesterday's instant scores
 * yesterday against the same daily target — that is how the report shows Today
 * and Yesterday side by side without a second set of targets.
 *
 * Caveat worth knowing: a LEAD_STAGE_LIVE KPI is a snapshot of where leads sit
 * *right now*, so it reads the same for Today and Yesterday. It measures a
 * standing position, not something that happened on a given day.
 */
export async function kpiScoreboardFor(
  db: PrismaClient | Prisma.TransactionClient,
  defs: (KpiDefinitionLike & { targets: { period: KpiPeriod; target: number; points: number | null }[] })[],
  userId: string,
  period: KpiPeriod,
  now = new Date(),
): Promise<{ score: number | null; max: number }> {
  let total = 0;
  let max = 0;
  let scoredAnything = false;

  for (const def of defs) {
    const t = def.targets.find((x) => x.period === period);
    if (!t || t.points == null) continue;
    max += t.points;
    const actual = await computeKpiActual(db, def, userId, period, now);
    const earned = kpiScore(actual, t.target, t.points);
    if (earned !== null) {
      total += earned;
      scoredAnything = true;
    }
  }

  // No scored KPI at all for this period reads as "not scored", not as zero.
  if (max === 0) return { score: null, max: 0 };
  return { score: scoredAnything ? Math.round(total * 10) / 10 : 0, max };
}

/**
 * The KPIs the system starts with — ordinary definitions, editable and
 * deletable like any other, seeded once so the page is never empty.
 */
export const DEFAULT_KPIS: {
  name: string;
  unit: string;
  source: KpiSource;
  leadStages?: string[];
  receiptType?: ReceiptType;
  /** Resolved at seed time: attach every option in this category, by name. */
  categoryName?: string;
  sortOrder: number;
}[] = [
  { name: 'Dialed Calls', unit: 'calls', source: 'FEEDBACK_COUNT', sortOrder: 1 },
  { name: 'Connected Calls', unit: 'calls', source: 'FEEDBACK_COUNT', categoryName: 'Connected', sortOrder: 2 },
  { name: 'Hot Leads', unit: 'leads', source: 'LEAD_STAGE_LIVE', leadStages: ['Hot'], sortOrder: 3 },
  { name: 'Warm Leads', unit: 'leads', source: 'LEAD_STAGE_LIVE', leadStages: ['Warm'], sortOrder: 4 },
  { name: 'Paid Apps', unit: 'apps', source: 'RECEIPT_COUNT', receiptType: 'APPLICATION', sortOrder: 5 },
  { name: 'Talktime', unit: 'min', source: 'CALL_TALKTIME_MINUTES', sortOrder: 6 },
];

/**
 * Creates the default KPIs the first time the page is opened.
 *
 * Runs only when there are none at all, so it cannot resurrect a KPI an admin
 * deliberately deleted, and never overwrites one they have edited.
 */
export async function seedDefaultKpisIfEmpty(
  db: PrismaClient,
  createdById: string,
): Promise<number> {
  const existing = await db.kpiDefinition.count();
  if (existing > 0) return 0;

  const categories = await db.feedbackCategory.findMany({ select: { id: true, name: true } });
  const catId = (name?: string) =>
    name ? categories.find((c) => c.name.toLowerCase() === name.toLowerCase())?.id : undefined;

  let created = 0;
  for (const d of DEFAULT_KPIS) {
    const cid = catId(d.categoryName);
    await db.kpiDefinition.create({
      data: {
        name: d.name,
        unit: d.unit,
        source: d.source,
        feedbackCategoryIds: cid ? [cid] : [],
        leadStages: d.leadStages ?? [],
        receiptType: d.receiptType ?? null,
        sortOrder: d.sortOrder,
        createdById,
      },
    });
    created++;
  }
  return created;
}
