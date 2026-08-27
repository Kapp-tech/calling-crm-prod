import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Lead code → Data Calling Type.
 *
 * A lead code is the `campaign` field on a Lead — "Lead Code" is what the UI
 * calls it. Rather than setting a Data Calling Type per lead at ingestion, an
 * admin maps the code once here and every lead carrying it takes that value.
 *
 * The mapping is applied by **writing** `Lead.dataCallingType`, not by deriving
 * it at read time. Deriving would have been less destructive, but the All Leads
 * filter, the filter-options list and the CSV export all read that column: a
 * derived column would show P1 while filtering for P1 found nothing. One stored
 * value keeps the number, the filter and the export in agreement.
 *
 * It overrides whatever the lead already had. That is not a detail to soften —
 * on production every one of the 16,337 leads already carries a Data Calling
 * Type and all of them read "L1", so a mapping that only filled blanks would
 * never do anything at all.
 */

/**
 * What a lead shows when its lead code is not in the LeadCode List.
 *
 * Deliberately a plain value written onto the lead rather than a blank: an
 * empty Data Calling Type is indistinguishable from "nobody has filled this in
 * yet", whereas "NA" says the code arrived unmapped and is waiting for someone
 * to map it. It also means the All Leads Data Calling Type filter can be used
 * to find exactly those leads.
 *
 * Not added to the Data Calling Type dropdown — it is a state, not a choice an
 * admin should be able to map a code to.
 */
export const UNMAPPED_CALLING_TYPE = 'NA';

/**
 * The Data Calling Type an incoming lead should be stored with.
 *
 * The mapping is the only source: a lead code that is not mapped yields "NA"
 * rather than falling back to whatever the CSV or API payload carried. That is
 * the whole point of the list — one place decides, and an unmapped code is
 * visibly unmapped instead of silently keeping a value nobody chose.
 *
 * Takes the prebuilt map rather than querying, because the bulk ingest path
 * creates leads inside a Promise.all.
 */
export function callingTypeForIngest(
  leadCodeCallingTypeMap: Map<string, string>,
  code: string | null | undefined,
): string {
  const key = (code ?? '').trim().toLowerCase();
  return (key && leadCodeCallingTypeMap.get(key)) || UNMAPPED_CALLING_TYPE;
}

/**
 * Matching is case-insensitive.
 *
 * Production carries the same code in several casings — KCLL, Kcll and kcll all
 * appear, as do BM101 and bm101 — and the All Leads campaign filter already
 * matches case-insensitively. A case-sensitive mapping would silently miss most
 * of the leads an admin thought they had just set.
 */
export function leadCodeWhere(code: string): Prisma.LeadWhereInput {
  return { campaign: { equals: code.trim(), mode: 'insensitive' } };
}

/** The Data Calling Type for a lead code, or null when it is not mapped. */
export async function callingTypeForLeadCode(
  db: PrismaClient | Prisma.TransactionClient,
  code: string | null | undefined,
): Promise<string | null> {
  const value = code?.trim();
  if (!value) return null;
  const row = await db.dropdownOption.findFirst({
    where: {
      type: 'LEAD_CODE',
      isActive: true,
      value: { equals: value, mode: 'insensitive' },
      leadCodeCallingType: { not: null },
    },
    select: { leadCodeCallingType: true },
  });
  return row?.leadCodeCallingType ?? null;
}

/**
 * Pushes a mapping onto every lead carrying that code.
 *
 * Returns the number of leads changed so the admin is told what their save
 * actually did — a mapping that quietly rewrote 2,588 rows with no feedback is
 * how people lose trust in a tool.
 *
 * Deliberately does nothing when the mapping has no Data Calling Type set:
 * clearing the mapping leaves the leads as they are rather than blanking a
 * column across thousands of rows, which is not recoverable from here.
 */
export async function applyLeadCodeMapping(
  db: PrismaClient | Prisma.TransactionClient,
  code: string,
  callingType: string | null,
): Promise<number> {
  if (!callingType) return 0;
  const { count } = await db.lead.updateMany({
    where: { ...leadCodeWhere(code), dataCallingType: { not: callingType } },
    data: { dataCallingType: callingType },
  });
  return count;
}
