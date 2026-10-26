import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * A lead's QA score, for the places that show one number rather than a list.
 *
 * Two figures, because they answer different questions:
 *   - `latest` — how the most recent scored call went. This is what the All
 *     Leads row shows: "where does this lead stand right now".
 *   - `average` — the lead's standing across every scored call, which is what
 *     the drawer calls the overall score.
 *
 * Both ignore calls the analyser declined to score. Those are not stored any
 * more (see the webhook), but rows written before that rule existed may still
 * be on file, so `score IS NOT NULL` is enforced here too rather than assumed.
 */
export interface LeadCallScore {
  /** Most recent scored call. */
  score: number;
  maxScore: number;
  grade: string | null;
  scoredAt: Date | null;
  /** Mean of every scored call for this lead, same scale as `score`. */
  average: number;
  /** How many of the lead's calls carry a score. */
  scoredCalls: number;
}

/**
 * Scores for a page of leads, in one query.
 *
 * Matching mirrors `callsForLead` in lib/call-log-matching.ts: a call counts
 * for a lead when the webhook attributed it (`leadId`), or when it matched
 * nothing and its number is the lead's number. Scoring only on `leadId` would
 * silently disagree with the call list the drawer shows directly underneath.
 *
 * One statement for the whole page, not one per lead — All Leads renders up to
 * 100 rows and production holds 80k+ leads, so a per-row query would be 100
 * round trips on every page change.
 */
export async function callScoresForLeads(
  leads: { id: string; phone: string | null }[],
  /**
   * Restrict to one agent's calls. Passed when the viewer is a counsellor:
   * the circle links through to Call Analysis, which pins them to their own
   * calls, so an unscoped number here would be a score they cannot open.
   */
  agentId?: string | null,
): Promise<Map<string, LeadCallScore>> {
  const out = new Map<string, LeadCallScore>();
  if (leads.length === 0) return out;

  // (leadId, last-10-digits) pairs. A number too short to be a phone number
  // is passed as NULL so it can never match by digits.
  const ids = leads.map((l) => l.id);
  const tails = leads.map((l) => {
    const digits = (l.phone ?? '').replace(/\D+/g, '');
    return digits.length >= 10 ? digits.slice(-10) : null;
  });

  const rows = await prisma.$queryRaw<
    {
      leadId: string;
      score: number;
      maxScore: number | null;
      grade: string | null;
      scoredAt: Date | null;
      average: number;
      scoredCalls: bigint;
    }[]
  >(Prisma.sql`
    WITH wanted AS (
      SELECT * FROM unnest(
        ${ids}::text[],
        ${tails}::text[]
      ) AS t("leadId", tail)
    ),
    /*
     * The two matching rules as separate branches rather than one OR'd join.
     *
     * An OR across two different columns defeats both indexes and makes this
     * a scan of CallLog — unacceptable on All Leads, which is the busiest
     * screen in the CRM and pages 100 rows at a time. Split, each branch uses
     * its own index: "CallLog"(leadId) for the first, and the partial
     * expression index on RIGHT("phoneNumber", 10) for the second.
     *
     * UNION ALL cannot double-count: one branch requires a non-null leadId
     * and the other requires leadId IS NULL, so no row satisfies both.
     *
     * RIGHT(phoneNumber, 10) = tail is exactly an endsWith(tail) match for a
     * 10-digit tail, which is what callsForLead does — same rule, in a form
     * an index can serve.
     */
    scored AS (
      SELECT w."leadId", ca.score, ca."maxScore", ca."qaGrade" AS grade,
             ca."scoredAt", ca."receivedAt"
      FROM wanted w
      JOIN "CallLog" cl ON cl."leadId" = w."leadId"
      JOIN "CallAnalysis" ca ON ca."callLogId" = cl.id
      WHERE ca.score IS NOT NULL
        AND (${agentId ?? null}::text IS NULL OR cl."agentId" = ${agentId ?? null}::text)

      UNION ALL

      SELECT w."leadId", ca.score, ca."maxScore", ca."qaGrade" AS grade,
             ca."scoredAt", ca."receivedAt"
      FROM wanted w
      JOIN "CallLog" cl
        ON cl."leadId" IS NULL
       AND RIGHT(cl."phoneNumber", 10) = w.tail
      JOIN "CallAnalysis" ca ON ca."callLogId" = cl.id
      WHERE w.tail IS NOT NULL AND ca.score IS NOT NULL
        AND (${agentId ?? null}::text IS NULL OR cl."agentId" = ${agentId ?? null}::text)
    ),
    agg AS (
      SELECT "leadId", AVG(score)::float8 AS average, COUNT(*) AS "scoredCalls"
      FROM scored GROUP BY "leadId"
    )
    SELECT DISTINCT ON (s."leadId")
      s."leadId", s.score, s."maxScore", s.grade, s."scoredAt",
      a.average, a."scoredCalls"
    FROM scored s
    JOIN agg a ON a."leadId" = s."leadId"
    -- Newest verdict wins; receivedAt breaks ties and covers a null scoredAt.
    ORDER BY s."leadId", s."scoredAt" DESC NULLS LAST, s."receivedAt" DESC
  `);

  for (const r of rows) {
    const maxScore = r.maxScore && r.maxScore > 0 ? r.maxScore : 100;
    out.set(r.leadId, {
      score: r.score,
      maxScore,
      grade: r.grade,
      scoredAt: r.scoredAt,
      average: Math.round(r.average * 10) / 10,
      scoredCalls: Number(r.scoredCalls),
    });
  }
  return out;
}
