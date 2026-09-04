/**
 * An agent who recorded no work in the window is measured against no target.
 *
 * The Caller-wise report used to give every agent the same target regardless of
 * whether they turned up, and the Total row multiplied that target by the whole
 * headcount. On 4 Sept the floor was credited with 4,260 dialled calls against a
 * target of 5,100 — 300 x 17 agents — when two of those seventeen had recorded
 * nothing at all. The team read as 84% of target when the fifteen people who
 * actually worked had done 95% of theirs. Himanshu's words: "this target is
 * creating descripency."
 *
 * ─── The trap this module exists to close ───────────────────────────────────
 *
 * Zeroing an absent agent's target is NOT enough on its own, and doing only
 * that would be far worse than the bug. `kpiScore` returns the FULL points when
 * `target <= 0`, and every percentage helper reads a zero target as "none
 * expected, so met" and prints 100%. An absent agent would come out of it with
 * a perfect score on every KPI. So absence has to zero the target, the
 * percentage, the points and the agent's own Max Score together — which is why
 * these live in one Prisma-free module that the email builder, the KPI page,
 * the page's CSV export and the API all call, rather than as four copies of a
 * conditional that only three of them remember.
 *
 * "Absent" means zero working days, and working days means days with recorded
 * calling work — a follow-up or a dialer call. Someone who dialled and achieved
 * nothing worked a day and keeps their full target: that is the difference
 * between a bad day and an absent one, and the report must not hide it. On the
 * 4 Sept report that distinction is Shivam Rajput (1 working day, nothing
 * achieved, target 300) against Kamaleswar Ghosh and Zaid Sultan (0 working
 * days, target 0).
 */

/** Zero working days in the window: nothing was expected of them. */
export function isAbsent(workingDays: number | null | undefined): boolean {
  return (workingDays ?? 0) === 0;
}

/** How many of these agents were present — the Total row's real headcount. */
export function presentCount(workingDays: (number | null | undefined)[]): number {
  return workingDays.filter((d) => !isAbsent(d)).length;
}

/** One agent's target: zero when they were absent. */
export function targetForAgent(
  target: number | null,
  workingDays: number | null | undefined,
): number | null {
  return isAbsent(workingDays) ? 0 : target;
}

/**
 * One agent's points: zero when absent.
 *
 * Never pass `kpiScore`'s output through unchanged for an absent agent — with a
 * zeroed target it awards the full points.
 */
export function scoreForAgent(
  score: number | null | undefined,
  workingDays: number | null | undefined,
): number | null {
  if (isAbsent(workingDays)) return 0;
  return score ?? null;
}

/** One agent's Max Score: zero when absent, so the column sums to the Total. */
export function maxScoreForAgent(
  maxScore: number,
  workingDays: number | null | undefined,
): number {
  return isAbsent(workingDays) ? 0 : maxScore;
}

/**
 * Achieved against target as a whole percentage, or null when there is no
 * target to measure against.
 *
 * A zero target on a PRESENT agent still means "none expected, so met" — that
 * is a deliberate target of nothing, not an absence.
 */
export function pctOf(
  actual: number | null | undefined,
  target: number | null,
): number | null {
  if (actual === null || actual === undefined || target === null) return null;
  return target <= 0 ? 100 : Math.round((actual / target) * 100);
}

/**
 * The TEAM's percentage, null when nobody was present.
 *
 * Without the guard this is the same zero-target trap one level up: with no
 * present agents the team's target is zero, `pctOf` reads that as "none
 * expected, so met", and a floor that did nothing reports 100%. Verified — the
 * first render of this change did exactly that on a database where every agent
 * was absent. A blank is the honest answer: there was no target to measure.
 */
export function pctForTeam(
  actual: number | null | undefined,
  target: number | null,
  present: number,
): number | null {
  if (present === 0) return null;
  return pctOf(actual, target);
}

/** As `pctOf`, but an absent agent is 0% and never 100%. */
export function pctForAgent(
  actual: number | null | undefined,
  target: number | null,
  workingDays: number | null | undefined,
): number | null {
  if (isAbsent(workingDays)) return 0;
  return pctOf(actual, target);
}
