import { UNSET_CLIENT_TYPE } from './college-attributes';

/**
 * College name → Client Type, for stamping onto a page of leads.
 *
 * Resolved live rather than stored on the lead: setting a college's Client Type
 * has to change what its existing leads show, not just the next ones ingested.
 *
 * Matching is on a trimmed, lower-cased name because `Lead.college` is free
 * text that arrives from uploads and the API, while the college list is
 * curated — "LPU " and "lpu" must both find the row stored as "LPU".
 *
 * The whole COLLEGE list is fetched rather than only the names on the page:
 * there are a few dozen of them, so one small query beats building an IN clause
 * per request, and it keeps the lower-casing on our side instead of relying on
 * the database's collation.
 */
export async function clientTypeByCollege(
  db: { dropdownOption: { findMany: Function } },
): Promise<(college: string | null | undefined) => string> {
  const rows = (await db.dropdownOption.findMany({
    where: { type: 'COLLEGE' },
    select: { value: true, collegeClientType: true },
  })) as { value: string; collegeClientType: string | null }[];

  const byName = new Map(
    rows.map((r) => [r.value.trim().toLowerCase(), r.collegeClientType?.trim() || null] as const),
  );

  return (college) => {
    const key = college?.trim().toLowerCase();
    if (!key) return UNSET_CLIENT_TYPE;
    return byName.get(key) || UNSET_CLIENT_TYPE;
  };
}
