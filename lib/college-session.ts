/**
 * One college per KAPP College ID per session year, and only one of them active.
 *
 * The same college returns each intake: 2026 exists, then 2027 arrives. Blocking
 * the KAPP ID outright meant the new session could not be set up at all, so
 * Himanshu asked for the ID to repeat across years — with two limits:
 *
 *   1. not twice for the SAME session/year, and
 *   2. never two ACTIVE rows for one ID.
 *
 * The second one is not bookkeeping, it is what keeps the rest of the system
 * unambiguous. Everything downstream resolves a college by NAME or by KAPP ID
 * and expects exactly one answer: the CSV upload turns a KAPP ID into one
 * college name, and All Leads reads Client Type and Session/Year from one
 * college row. With two active rows for one ID, both of those become whichever
 * row the database happened to return first.
 *
 * So the sequence for a new intake is: deactivate 2026, then create 2027. The
 * messages say that, rather than refusing without explanation.
 *
 * Pure and Prisma-free: the caller fetches the sibling rows, this decides. That
 * keeps the rule in one place for both the create and the edit path — written
 * twice, it would have been sidestepped by creating 2027 while 2026 was off and
 * then switching 2026 back on.
 */

export interface CollegeSibling {
  value: string;
  collegeSessionYear: string | null;
  isActive: boolean;
}

/** Trimmed, or null — "" and "  " both mean "no session year set". */
export function normaliseSessionYear(year: string | null | undefined): string | null {
  return year?.trim() || null;
}

function describe(sib: CollegeSibling): string {
  const year = normaliseSessionYear(sib.collegeSessionYear);
  return `"${sib.value}"${year ? ` (session/year ${year})` : ''}`;
}

/**
 * The reason this college cannot be saved, or null when it can.
 *
 * `siblings` must be the other COLLEGE rows sharing this KAPP College ID — the
 * row being edited excluded. Pass `year` only when it is being set or changed,
 * and `activating` only when the row will end up active; each check runs only
 * when its input is in play, so an edit that touches neither is unaffected.
 */
export function collegeSessionConflict(
  kappCollegeId: string,
  siblings: CollegeSibling[],
  opts: { year?: string | null; activating?: boolean },
): string | null {
  if (opts.year !== undefined) {
    const year = normaliseSessionYear(opts.year);
    const clash = siblings.find(
      (sib) => normaliseSessionYear(sib.collegeSessionYear) === year,
    );
    if (clash) {
      return year
        ? `${describe(clash)} already uses KAPP College ID ${kappCollegeId} for session/year ${year}. `
          + 'Give this one a different Session/Year.'
        : `"${clash.value}" already uses KAPP College ID ${kappCollegeId} with no Session/Year set. `
          + 'Set a Session/Year on this one.';
    }
  }

  if (opts.activating) {
    const active = siblings.find((sib) => sib.isActive);
    if (active) {
      return `${describe(active)} is still active for KAPP College ID ${kappCollegeId}. `
        + 'Only one college per KAPP College ID can be active — deactivate that one first.';
    }
  }

  return null;
}
