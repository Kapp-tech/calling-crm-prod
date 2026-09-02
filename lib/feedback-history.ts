import { Prisma } from '@prisma/client';

/**
 * EVERY follow-up ever logged — live and archived — as one relation.
 *
 * Reassigning a lead with "reset feedbacks" moves the outgoing agent's
 * follow-ups from `LeadFeedback` into `LeadFeedbackArchive` and deletes them
 * from the live table, so the new agent starts on a clean lead. That is
 * deliberate and stays.
 *
 * What was NOT deliberate is the effect on history. Every performance figure
 * read only the live table, so the moment a lead was reassigned the previous
 * agent's work vanished from *past* dates too. On 31 Aug the emailed report
 * credited Harsh Yadav with 306 dialled calls; after a reassignment the next
 * morning the same date on the KPI page showed 248. The 58 missing leads were
 * sitting in the archive. Across the database 16,762 of 47,949 follow-ups —
 * over a third — had already been moved this way.
 *
 * A day that has closed must keep the numbers it closed with. Reading both
 * tables everywhere is what makes a three-month-old date match the report that
 * went out that morning.
 *
 * UNION ALL rather than UNION: archiving deletes the live row in the same
 * transaction, so a follow-up is in exactly one table and there is nothing to
 * de-duplicate. Verified against production — zero rows appear in both.
 * UNION would pay for a distinct sort on every read for no benefit.
 *
 * Only the columns any caller needs. Widening this means checking that both
 * tables really do carry the column: they are near-identical, but the archive
 * also has `cycle`, `archivedAt` and `archivedById`, which `LeadFeedback` does
 * not, and a mismatched UNION fails at query time rather than compile time.
 */
export const FEEDBACK_HISTORY = Prisma.sql`(
  SELECT "leadId", "agentId", "feedbackOptionId", "createdAt" FROM "LeadFeedback"
  UNION ALL
  SELECT "leadId", "agentId", "feedbackOptionId", "createdAt" FROM "LeadFeedbackArchive"
)`;

/**
 * The option/category narrowing a KPI definition carries, as SQL.
 *
 * Options and categories are OR'd — "count Hot, Warm, or anything Connected" —
 * and both empty means no narrowing at all, matching `feedbackWhere()` on the
 * Prisma side. The two column references are passed in because callers alias
 * the tables differently.
 */
export function feedbackNarrowingSql(
  optionIds: string[],
  categoryIds: string[],
  optionCol: Prisma.Sql,
  categoryCol: Prisma.Sql,
): Prisma.Sql {
  if (optionIds.length === 0 && categoryIds.length === 0) return Prisma.sql`TRUE`;
  return Prisma.join(
    [
      ...(optionIds.length > 0 ? [Prisma.sql`${optionCol} IN (${Prisma.join(optionIds)})`] : []),
      ...(categoryIds.length > 0 ? [Prisma.sql`${categoryCol} IN (${Prisma.join(categoryIds)})`] : []),
    ],
    ' OR ',
  );
}
