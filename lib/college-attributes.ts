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

export type CollegeZone = (typeof COLLEGE_ZONES)[number];
export type CollegeDealType = (typeof COLLEGE_DEAL_TYPES)[number];
