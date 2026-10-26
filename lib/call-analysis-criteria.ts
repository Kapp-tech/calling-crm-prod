/**
 * How a QA verdict is presented.
 *
 * Two facts about the analyser's payload drive everything here:
 *
 * 1. **Every criterion is already a 0–100 percentage**, and `null` means "not
 *    applicable to this call" — `objection_handling: null` is a call where the
 *    student raised no objection, not a call that handled one badly. A null
 *    must never render as a zero bar, and must never be averaged.
 * 2. **The overall `qa_score` is weighted, not the mean of the criteria.** A
 *    real verdict scored 86.14 where the plain mean of its criteria is 83.1.
 *    So the overall score is always displayed as the analyser sent it; nothing
 *    on this page recomputes it.
 *
 * The criterion list is the analyser's vocabulary, not ours. Unknown keys are
 * rendered under "Other" with a humanised label rather than dropped, so adding
 * a criterion upstream shows up here without a code change.
 */

export interface CriterionGroup {
  title: string;
  hint: string;
  keys: string[];
}

export const CRITERION_LABELS: Record<string, { label: string; hint: string }> = {
  fraud: { label: 'Fraud Check', hint: '100 means no false promises or misleading claims were made' },
  correct_info: { label: 'Correct Information', hint: 'Whether the facts given about fees, courses and campus were accurate' },
  script: { label: 'Script Adherence', hint: 'How closely the agent followed the approved calling script' },
  communication: { label: 'Communication', hint: 'Clarity, pace and language of the agent' },
  listening: { label: 'Active Listening', hint: 'Whether the agent let the student speak and picked up what they said' },
  objection_handling: { label: 'Objection Handling', hint: 'How objections were answered — not applicable when none were raised' },
  engagement: { label: 'Engagement', hint: 'How well the agent held the student’s interest' },
  professional: { label: 'Professionalism', hint: 'Tone, courtesy and conduct' },
  questions_answered: { label: 'Questions Answered', hint: 'Whether the student’s questions were actually answered' },
  outcome: { label: 'Call Outcome', hint: 'Whether the call reached a clear next step' },
};

/**
 * Grouped so the page can be read a section at a time: a compliance problem is
 * a different conversation from a coaching one, and someone scanning for risk
 * should not have to pick the two fraud-shaped criteria out of a list of ten.
 */
export const CRITERION_GROUPS: CriterionGroup[] = [
  {
    title: 'Compliance & Accuracy',
    hint: 'Did the agent stay honest and on-script?',
    keys: ['fraud', 'correct_info', 'script'],
  },
  {
    title: 'Conversation Quality',
    hint: 'How the call was handled',
    keys: ['communication', 'listening', 'objection_handling', 'engagement', 'professional'],
  },
  {
    title: 'Effectiveness',
    hint: 'Did the call get anywhere?',
    keys: ['questions_answered', 'outcome'],
  },
];

/** `objection_handling` → `Objection Handling`, for criteria we have no label for. */
export function humaniseCriterion(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export type Band = 'excellent' | 'good' | 'average' | 'poor';

/** Best to worst, for ordering a distribution by quality rather than by size. */
export const BAND_RANK: Record<Band, number> = {
  excellent: 0, good: 1, average: 2, poor: 3,
};

/** Bands a 0–100 value. Shared by the overall score, grades and criteria, so a
 *  76 is the same colour wherever it appears on the page. */
export function band(pct: number): Band {
  if (pct >= 85) return 'excellent';
  if (pct >= 70) return 'good';
  if (pct >= 50) return 'average';
  return 'poor';
}

/**
 * `text` doubles as the ring colour: the arc is stroked with `currentColor`,
 * so it needs no `stroke-*` utility of its own. That is deliberate — the
 * stroke classes this map used to carry existed nowhere else in the tree and
 * were purged by Tailwind, leaving an empty circle beside a correctly
 * coloured badge.
 */
export const BAND_STYLES: Record<Band, { text: string; bar: string; chip: string }> = {
  excellent: {
    text: 'text-emerald-600 dark:text-emerald-400',
    bar: 'bg-emerald-500',
    chip: 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  good: {
    text: 'text-sky-600 dark:text-sky-400',
    bar: 'bg-sky-500',
    chip: 'border-sky-300/50 bg-sky-500/10 text-sky-700 dark:text-sky-400',
  },
  average: {
    text: 'text-amber-600 dark:text-amber-400',
    bar: 'bg-amber-500',
    chip: 'border-amber-300/50 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  },
  poor: {
    text: 'text-red-600 dark:text-red-400',
    bar: 'bg-red-500',
    chip: 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-400',
  },
};

/**
 * Grade names the analyser is known to send. An unrecognised grade keeps its
 * own text and is coloured from the score instead, so a renamed or added grade
 * degrades to "shown but coloured by number" rather than "shown unstyled".
 */
const KNOWN_GRADES: Record<string, Band> = {
  excellent: 'excellent',
  good: 'good',
  average: 'average',
  fair: 'average',
  poor: 'poor',
  bad: 'poor',
};

export function gradeBand(grade: string | null, pct: number | null): Band {
  const known = grade ? KNOWN_GRADES[grade.trim().toLowerCase()] : undefined;
  if (known) return known;
  return band(pct ?? 0);
}

/** Percentage of max, for a score the analyser may have sent out of something
 *  other than 100. Null-safe: an unscored row has no percentage. */
export function toPercent(score: number | null, maxScore: number | null): number | null {
  if (score === null) return null;
  const max = maxScore && maxScore > 0 ? maxScore : 100;
  return Math.max(0, Math.min(100, (score / max) * 100));
}

/** Reads the metrics blob into an ordered, grouped list, with every value
 *  either a 0–100 number or null for "not applicable". */
export function groupMetrics(metrics: unknown): { title: string; hint: string; items: { key: string; label: string; hint: string; value: number | null }[] }[] {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return [];
  const entries = metrics as Record<string, unknown>;
  const read = (k: string): number | null => {
    const v = entries[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const known = new Set(CRITERION_GROUPS.flatMap((g) => g.keys));
  const extras = Object.keys(entries).filter((k) => !known.has(k));

  const groups = CRITERION_GROUPS.map((g) => ({
    title: g.title,
    hint: g.hint,
    items: g.keys
      // Only criteria the analyser actually sent — a payload carrying three of
      // the ten should show three rows, not seven phantom "N/A"s.
      .filter((k) => k in entries)
      .map((k) => ({
        key: k,
        label: CRITERION_LABELS[k]?.label ?? humaniseCriterion(k),
        hint: CRITERION_LABELS[k]?.hint ?? '',
        value: read(k),
      })),
  })).filter((g) => g.items.length > 0);

  if (extras.length) {
    groups.push({
      title: 'Other',
      hint: 'Criteria this version of the CRM does not have a label for',
      items: extras.map((k) => ({
        key: k,
        label: CRITERION_LABELS[k]?.label ?? humaniseCriterion(k),
        hint: '',
        value: read(k),
      })),
    });
  }
  return groups;
}
