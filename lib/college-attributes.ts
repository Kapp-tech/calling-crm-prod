/**
 * The fixed choices for a college's Zone and Deal Type.
 *
 * These are deliberately hardcoded rather than being Manage Dropdowns entries:
 * they are a small, stable business taxonomy, and the Zones / Deal Type
 * management screens were retired precisely so these values stop drifting.
 *
 * Kept in one place so the Manage Colleges dropdowns and the server-side
 * validation cannot disagree — adding a value here makes it selectable AND
 * accepted, with no second edit to remember.
 */
export const COLLEGE_ZONES = ['North', 'South', 'East', 'West', 'Central'] as const;

/**
 * Agents are tagged with the same five zones as colleges, so "which zone does
 * this agent cover" and "which zone is this college in" line up on reports
 * rather than being two unrelated vocabularies.
 */
export const AGENT_ZONES = COLLEGE_ZONES;

export const COLLEGE_DEAL_TYPES = ['Branding', 'CPL', 'CPA', 'CPS'] as const;

/**
 * Whether the college is a paying client.
 *
 * Unlike Zone and Deal Type, this is NOT copied onto the lead when it is
 * ingested — it is read from the college every time a lead is listed. A college
 * signed today changes what every one of its existing leads shows, which is the
 * behaviour asked for: "NA will be changed to the respective value". A stamped
 * copy would only ever apply to leads created after the change.
 */
export const COLLEGE_CLIENT_TYPES = ['Client', 'Non Client'] as const;

/** Shown against a lead whose college has no Client Type set yet. */
export const UNSET_CLIENT_TYPE = 'NA';

/**
 * Shown for a lead whose college has no Session / Year set. Same literal as the
 * unset Client Type and deliberately so — the two sit next to each other in All
 * Leads, and one reading "NA" while the other sat blank would look like a fault
 * in one of them. Kept as its own constant so either can change without the
 * other.
 */
export const UNSET_SESSION_YEAR = 'NA';

export type CollegeZone = (typeof COLLEGE_ZONES)[number];
export type CollegeDealType = (typeof COLLEGE_DEAL_TYPES)[number];
export type CollegeClientType = (typeof COLLEGE_CLIENT_TYPES)[number];

/**
 * What the reports show for a lead whose college is unset.
 *
 * Lives here, not in lib/reports.ts, because the Reports page needs it too as
 * a selectable filter option — and lib/reports.ts imports PrismaClient, so a
 * client component cannot import from it. Both sides reading one constant is
 * what stops the filter value drifting from the label it is meant to match.
 */
export const NO_COLLEGE_LABEL = '(No college set)';

/**
 * How many colleges a student's shortlist may hold.
 *
 * Read by the picker (to disable Submit and say why) and by the API (to
 * reject). One constant so the button cannot allow what the endpoint refuses.
 * Generous rather than tight — a real shortlist is a handful, but the bound
 * exists to stop a runaway "select all" over ~9,700 colleges reaching the LMS.
 */
export const MAX_COLLEGE_PREFERENCES = 100;
