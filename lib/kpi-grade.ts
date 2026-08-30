/**
 * Score % to a grade.
 *
 * The bands Himanshu set:
 *
 *   Excellent           85 – 100
 *   Very Good           70 – 85
 *   Good                50 – 70
 *   Needs Improvement   30 – 50
 *   Unsatisfactory      below 30
 *
 * The bands as written share their endpoints — 85 is in both Excellent and Very
 * Good, 70 in both Very Good and Good, and so on. The higher band takes the
 * boundary, which is how "85% - 100%" normally reads: exactly 85 is Excellent,
 * 84 is Very Good.
 *
 * Its own module, with no server imports, because both the KPI Targets page (a
 * client component) and the emailed report need it — and importing it from
 * anything that touches Prisma would drag PrismaClient into the browser bundle.
 */
export function gradeFor(pct: number | null): string {
  if (pct === null) return '';
  if (pct >= 85) return 'Excellent';
  if (pct >= 70) return 'Very Good';
  if (pct >= 50) return 'Good';
  if (pct >= 30) return 'Needs Improvement';
  return 'Unsatisfactory';
}
