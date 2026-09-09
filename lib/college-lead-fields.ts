import { UNSET_CLIENT_TYPE, UNSET_SESSION_YEAR } from './college-attributes';

/**
 * The college-owned fields that All Leads shows against a lead: Client Type and
 * Session / Year.
 *
 * Both are resolved live from the college row rather than stored on the lead,
 * because editing a college has to change what its EXISTING leads show, not
 * just the next ones ingested. That is the whole point of them — Himanshu asked
 * for exactly this on Client Type ("When added NA will be changed to the
 * respective value") and again on Session / Year ("I will update any year on any
 * college and it will be changed on all leads table").
 *
 * Matching is on a trimmed, lower-cased name because `Lead.college` is free
 * text arriving from uploads and the API, while the college list is curated —
 * "LPU " and "lpu" must both find the row stored as "LPU".
 *
 * ACTIVE rows only, and that is load-bearing now that a college may exist once
 * per session year: 2026 and 2027 can both be rows sharing a name and KAPP ID,
 * and only one of them is active. Without the filter this map would keep
 * whichever row the database happened to return last, so a lead's Session/Year
 * and Client Type would be arbitrary. The active row is the college's current
 * intake, which is what the columns are meant to show.
 *
 * One query for both fields, and the whole active COLLEGE list rather than only
 * the names on the page: there are a few dozen of them, so one small query beats an
 * IN clause per request and keeps the lower-casing on our side instead of
 * relying on the database's collation.
 *
 * Replaced `clientTypeByCollege`, which did the same thing for one field. A
 * second near-identical resolver would have meant a second query and a second
 * place for the matching rule to drift.
 */
export async function collegeLeadFields(
  db: { dropdownOption: { findMany: Function } },
): Promise<{
  clientTypeOf: (college: string | null | undefined) => string;
  sessionYearOf: (college: string | null | undefined) => string;
}> {
  const rows = (await db.dropdownOption.findMany({
    where: { type: 'COLLEGE', isActive: true },
    select: { value: true, collegeClientType: true, collegeSessionYear: true },
  })) as { value: string; collegeClientType: string | null; collegeSessionYear: string | null }[];

  const byName = new Map(
    rows.map((r) => [
      r.value.trim().toLowerCase(),
      {
        clientType: r.collegeClientType?.trim() || null,
        sessionYear: r.collegeSessionYear?.trim() || null,
      },
    ] as const),
  );

  const look = (college: string | null | undefined) => {
    const key = college?.trim().toLowerCase();
    return key ? byName.get(key) : undefined;
  };

  return {
    clientTypeOf: (college) => look(college)?.clientType || UNSET_CLIENT_TYPE,
    sessionYearOf: (college) => look(college)?.sessionYear || UNSET_SESSION_YEAR,
  };
}
