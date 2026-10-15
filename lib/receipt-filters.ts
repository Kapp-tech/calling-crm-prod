import { Prisma, PrismaClient, ReceiptStatus, ReceiptType } from '@prisma/client';
import { istStartOfDay, istEndOfDay } from '@/lib/ist-time';

/**
 * The Receipt Approvals filter set, in ONE place.
 *
 * Shared by the list (`/api/receipts`) and the CSV export
 * (`/api/receipts/export`) because the last time an export built its own
 * filters they silently drifted: All Leads showed 8,145 rows and downloaded
 * 80,847, since the export's schema quietly dropped the parameters it did not
 * declare. One builder means the download cannot disagree with the screen.
 *
 * Add a filter here and both paths get it; there is nowhere else to forget.
 */

/** Read the filters off a querystring. Unknown/blank values are ignored, never guessed. */
export function parseReceiptFilters(searchParams: URLSearchParams) {
  const status = (searchParams.get('status') ?? 'PENDING').toUpperCase();
  const type = searchParams.get('type')?.toUpperCase();
  return {
    status,
    type,
    search: searchParams.get('search')?.trim() || undefined,
    // Paid date, not createdAt: the money is what this screen is about, and it
    // is the same field the KPI and Caller-wise report count receipts by. A
    // receipt approved in October for a September payment belongs to September.
    from: searchParams.get('from')?.trim() || undefined,
    to: searchParams.get('to')?.trim() || undefined,
    /**
     * `unique` / `duplicate` — a repeat-student scope, orthogonal to status.
     *
     * Both show students who appear on MORE THAN ONE receipt; they differ on
     * whether the college differs with them:
     *
     *   duplicate — same student, SAME college. Probably one payment entered
     *               twice, and the thing to review.
     *   unique    — same student, DIFFERENT colleges. Looks like a duplicate
     *               and is not: a student applying to three colleges pays
     *               three times, which the referral rules already treat as
     *               legitimate.
     *
     * A student appearing exactly once is in neither: there is nothing to
     * compare them against.
     */
    dup: ((): 'unique' | 'duplicate' | undefined => {
      const v = searchParams.get('dup')?.trim().toLowerCase();
      return v === 'unique' || v === 'duplicate' ? v : undefined;
    })(),
  };
}

/**
 * Receipt ids in the requested repeat-student scope.
 *
 * Done in SQL and resolved to ids because the question is about GROUPS of
 * receipts — "does this student appear again, and under a different college" —
 * which a Prisma `where` on a single row cannot ask.
 *
 * Identity is email AND mobile, both normalised: lower-cased and trimmed for
 * the email, digits-only for the mobile, so "+91 98765 43210" and
 * "9876543210" are one person. Requiring both is the strict choice — a student
 * who used a second email would not be flagged — but the looser rule groups
 * siblings who share a phone, and a false duplicate on a finance screen costs
 * more than a missed one.
 *
 * College comes from the LEAD, not the receipt's campus: campus is free text
 * an agent types per receipt, while the lead's college is the curated value
 * everything else in the CRM reconciles against.
 */
export async function resolveDupScopeIds(
  db: PrismaClient,
  dup: 'unique' | 'duplicate',
): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    WITH r AS (
      SELECT lr.id,
             lower(btrim(lr.email))                     AS em,
             -- Doubled backslash on purpose: this sits in a JS template
             -- literal, where a lone \D is not a valid escape and collapses
             -- to a bare D — which strips the letter D from the number and
             -- normalises nothing.
             regexp_replace(lr.mobile, '\\D', '', 'g')  AS ph,
             lower(btrim(coalesce(l.college, '')))      AS college
      FROM "LeadReceipt" lr
      JOIN "Lead" l ON l.id = lr."leadId"
    ), g AS (
      SELECT em, ph, count(*) AS n, count(DISTINCT college) AS cols
      FROM r GROUP BY em, ph
    )
    SELECT r.id FROM r JOIN g ON g.em = r.em AND g.ph = r.ph
    WHERE g.n > 1 AND ${dup === 'duplicate' ? Prisma.sql`g.cols = 1` : Prisma.sql`g.cols > 1`}
  `);
  return rows.map((r) => r.id);
}

export type ReceiptFilters = ReturnType<typeof parseReceiptFilters>;

/**
 * The full where clause, including the repeat-student scope.
 *
 * Async because that scope needs a query — see resolveDupScopeIds. Both the
 * list and the CSV call THIS, so a scope added here cannot reach one and miss
 * the other.
 */
export async function buildReceiptWhereAsync(
  db: PrismaClient,
  f: ReceiptFilters,
): Promise<Prisma.LeadReceiptWhereInput> {
  const base = buildReceiptWhere(f);
  if (!f.dup) return base;
  const ids = await resolveDupScopeIds(db, f.dup);
  // An empty scope must match NOTHING. `in: []` says that; omitting the clause
  // would quietly widen the card to every receipt.
  return { AND: [base, { id: { in: ids } }] };
}

export function buildReceiptWhere(f: ReceiptFilters): Prisma.LeadReceiptWhereInput {
  // IST day boundaries, so "1 Oct to 1 Oct" means that whole day as the office
  // experienced it. A bare `new Date('2026-10-01')` is midnight UTC — 05:30 IST
  // — which would drop the first five and a half hours of the day.
  const paidDate =
    f.from || f.to
      ? {
          ...(f.from ? { gte: istStartOfDay(f.from) } : {}),
          ...(f.to ? { lte: istEndOfDay(f.to) } : {}),
        }
      : undefined;

  return {
    ...(f.status !== 'ALL' && f.status in ReceiptStatus
      ? { status: f.status as ReceiptStatus }
      : {}),
    ...(f.type && f.type in ReceiptType ? { type: f.type as ReceiptType } : {}),
    ...(paidDate ? { paidDate } : {}),
    ...(f.search
      ? {
          OR: [
            { studentName: { contains: f.search, mode: 'insensitive' as const } },
            { email: { contains: f.search, mode: 'insensitive' as const } },
            { mobile: { contains: f.search } },
            { receiptNumber: { contains: f.search, mode: 'insensitive' as const } },
            { lead: { id: { contains: f.search, mode: 'insensitive' as const } } },
            // The lead's own code — searchable now that the table shows it.
            // Shared builder, so the CSV narrows identically.
            { lead: { campaign: { contains: f.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
}
