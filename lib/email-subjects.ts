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
  WELCOME: 'Welcome to the Counselling CRM',
};

/** What a rule will actually send: the admin's subject, else the report's own. */
export function subjectFor(reportType: string, ruleSubject: string | null | undefined): string {
  return ruleSubject?.trim() || DEFAULT_EMAIL_SUBJECTS[reportType] || 'Counselling CRM';
}
