/**
 * The default subject for each recurring report.
 *
 * A separate module with no server imports on purpose: the rules UI is a client
 * component and needs these to show what a blank Subject field will send, while
 * the builders need them to actually send it. Reading them from
 * `lib/email-reports.ts` would drag PrismaClient into the browser bundle.
 *
 * Constant by design — see the THREADING note in lib/email-reports.ts. A subject
 * that changes per send starts a new conversation every time.
 */
export const DEFAULT_EMAIL_SUBJECTS: Record<string, string> = {
  TEAM_SUMMARY: 'Team performance',
  AGENT_PERFORMANCE: 'Your performance',
  FEEDBACK_SUMMARY: 'Feedback summary',
  COLLEGE_WISE: 'University / College wise',
  AGENT_WISE: 'Agent wise report',
  OVERALL_CALLING: 'Overall Calling Report',
  // ALL_REPORTS is computed per month — see allReportsSubject below.
  WELCOME: 'Welcome to the Counselling CRM',
};

/**
 * The "All reports" subject carries the month, so it is computed rather than
 * stored — a constant would still say "August" next February.
 *
 * This is the one recurring subject that deliberately changes: it starts a new
 * mail thread each month, which is the point. Every other report keeps a fixed
 * subject so its sends stay in one conversation (see the THREADING note in
 * lib/email-reports.ts).
 */
export function allReportsSubject(now: Date = new Date()): string {
  const month = new Intl.DateTimeFormat('en-GB', {
    month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata',
  }).format(now);
  return `Overall Call Centre_ Calling Summary Report || ${month}`;
}

/** What a rule will actually send: the admin's subject, else the report's own. */
export function subjectFor(
  reportType: string,
  ruleSubject: string | null | undefined,
  now: Date = new Date(),
): string {
  const typed = ruleSubject?.trim();
  if (typed) return typed;
  if (reportType === 'ALL_REPORTS') return allReportsSubject(now);
  return DEFAULT_EMAIL_SUBJECTS[reportType] || 'Counselling CRM';
}
