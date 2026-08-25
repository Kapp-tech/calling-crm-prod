import { KpiPeriod, KpiSource, Prisma, PrismaClient, ReceiptType } from '@prisma/client';
import { istStartOfDay, istEndOfDay, istDayKey, istShiftDays, toUtcSqlTimestamp } from './ist-time';

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
 * Builds the feedback filter for a definition.
 *
 * Options and categories are OR'd: "count Hot, Warm, or anything Connected".
 * Both empty means no narrowing at all — every feedback counts.
 */
function feedbackWhere(def: KpiDefinitionLike): Prisma.LeadFeedbackWhereInput {
  const or: Prisma.LeadFeedbackWhereInput[] = [];
  if (def.feedbackOptionIds.length > 0) or.push({ feedbackOptionId: { in: def.feedbackOptionIds } });
  if (def.feedbackCategoryIds.length > 0) {
    or.push({ feedbackOption: { categoryId: { in: def.feedbackCategoryIds } } });
  }
  return or.length === 0 ? {} : { OR: or };
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
  period: KpiPeriod,
  now = new Date(),
): Promise<number | null> {
  const { from, to } = kpiPeriodRange(period, now);
  const inPeriod = { gte: from, lte: to };

  switch (def.source) {
    case 'FEEDBACK_COUNT':
      return db.leadFeedback.count({
        where: { agentId: userId, createdAt: inPeriod, ...feedbackWhere(def) },
      });

    case 'FEEDBACK_LEADS': {
      // Distinct leads rather than rows: groupBy is the cheapest way to get a
      // distinct count out of Prisma without a raw query.
      const rows = await db.leadFeedback.groupBy({
        by: ['leadId'],
        where: { agentId: userId, createdAt: inPeriod, ...feedbackWhere(def) },
      });
      return rows.length;
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
      const optionIds = def.feedbackOptionIds;
      const categoryIds = def.feedbackCategoryIds;

      // Both empty means no narrowing, exactly as feedbackWhere() behaves —
      // every lead the agent followed up counts, which is the same set
      // FEEDBACK_LEADS would return.
      const narrowing =
        optionIds.length === 0 && categoryIds.length === 0
          ? Prisma.sql`TRUE`
          : Prisma.join(
              [
                ...(optionIds.length > 0
                  ? [Prisma.sql`l."feedbackOptionId" IN (${Prisma.join(optionIds)})`]
                  : []),
                ...(categoryIds.length > 0
                  ? [Prisma.sql`fo."categoryId" IN (${Prisma.join(categoryIds)})`]
                  : []),
              ],
              ' OR ',
            );

      const rows = await db.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        WITH latest AS (
          SELECT DISTINCT ON (f."leadId") f."leadId", f."feedbackOptionId"
          FROM "LeadFeedback" f
          WHERE f."agentId" = ${userId}
            AND f."createdAt" >= ${toUtcSqlTimestamp(from)}::timestamp
            AND f."createdAt" <= ${toUtcSqlTimestamp(to)}::timestamp
          ORDER BY f."leadId", f."createdAt" DESC
        )
        SELECT count(*)::bigint AS count
        FROM latest l
        LEFT JOIN "FeedbackOption" fo ON fo.id = l."feedbackOptionId"
        WHERE ${narrowing}
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
      return db.leadReceipt.count({
        where: {
          status: 'APPROVED',
          ...(def.receiptType ? { type: def.receiptType } : {}),
          paidDate: inPeriod,
          lead: { assignedToId: userId },
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
