/**
 * Score % to a letter.
 *
 * Nothing in the data model defines a grading scale, so this is a plain
 * 10-point band chosen to be obvious rather than clever. Change the thresholds
 * here and every place a grade appears follows.
 *
 * Its own module, with no server imports, because both the KPI Targets page (a
 * client component) and the emailed report need it — and importing it from
 * anything that touches Prisma would drag PrismaClient into the browser bundle.
 */
export function gradeFor(pct: number | null): string {
  if (pct === null) return '';
  if (pct >= 90) return 'A+';
  if (pct >= 80) return 'A';
  if (pct >= 70) return 'B';
  if (pct >= 60) return 'C';
  if (pct >= 50) return 'D';
  return 'E';
}
