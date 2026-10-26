'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';
import { BAND_STYLES, band, gradeBand, type Band } from '@/lib/call-analysis-criteria';

/**
 * A score as a ring, for the one number the reader looks at first.
 * Shows the analyser's score verbatim — nothing here recomputes it.
 */
export function ScoreRing({
  pct, label, size = 48,
}: { pct: number | null; label: string | null; size?: number }) {
  const stroke = size >= 64 ? 5 : 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const b: Band = gradeBand(label, pct);
  const s = BAND_STYLES[b];

  if (pct === null) {
    return (
      <div
        className="flex shrink-0 items-center justify-center rounded-full border border-dashed border-border text-[10px] font-medium text-muted-foreground"
        style={{ width: size, height: size }}
        title="The analyser has not scored this call"
      >
        n/s
      </div>
    );
  }

  const shown = Math.max(0, Math.min(100, pct));

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* Both arcs are stroked with currentColor and take their hue from a
          text-* class, so the ring cannot be broken again by a purged
          stroke-* utility. */}
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          className="text-muted" stroke="currentColor" strokeWidth={stroke} fill="none"
        />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          className={cn('transition-[stroke-dashoffset] duration-500', s.text)}
          stroke="currentColor" strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * shown) / 100}
        />
      </svg>
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center font-bold tabular-nums',
          size >= 64 ? 'text-lg' : 'text-[13px]',
          s.text,
        )}
      >
        {Math.round(pct)}
      </span>
    </div>
  );
}

export function GradeChip({ grade, pct }: { grade: string | null; pct: number | null }) {
  if (!grade) return <span className="text-xs text-muted-foreground">—</span>;
  const s = BAND_STYLES[gradeBand(grade, pct)];
  return (
    <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold', s.chip)}>
      {grade}
    </span>
  );
}

/**
 * One criterion as an inline proportional bar.
 *
 * `null` is the "not applicable" case and gets an empty track plus an explicit
 * N/A — never a zero-width bar, which reads as a score of nought.
 */
export function CriterionBar({
  label, hint, value,
}: { label: string; hint: string; value: number | null }) {
  const na = value === null;
  const s = na ? null : BAND_STYLES[band(value)];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1" title={hint || undefined}>
      <span className="truncate text-xs text-foreground/80">{label}</span>
      <span
        className={cn(
          'text-xs font-bold tabular-nums',
          na ? 'text-muted-foreground/70' : s!.text,
        )}
      >
        {na ? 'N/A' : Math.round(value)}
      </span>
      {/* The track needs to read as a track even at value 0, so it is keyed
          off the foreground, not bg-muted — which all but disappears against
          the panel's own muted background. */}
      <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
        {!na && (
          <div
            className={cn('h-full rounded-full transition-[width]', s!.bar)}
            style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * A lead's score as a link through to its Call Analysis.
 *
 * Used in the All Leads row and the lead drawer, so the same number looks the
 * same in both. Renders nothing but a dash when the lead has no scored call —
 * most leads will not have one, and a row of empty circles would read as a
 * column of zeros.
 */
export function LeadScoreLink({
  leadId, score, maxScore, grade, scoredCalls, size = 36, label, onNavigate,
}: {
  leadId: string;
  score: number | null;
  maxScore: number | null;
  grade: string | null;
  scoredCalls?: number;
  size?: number;
  label?: string;
  onNavigate?: () => void;
}) {
  if (score === null) {
    return <span className="text-xs text-muted-foreground" title="No scored call for this lead yet">—</span>;
  }
  const max = maxScore && maxScore > 0 ? maxScore : 100;
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  const calls = scoredCalls && scoredCalls > 1 ? ` across ${scoredCalls} scored calls` : '';

  return (
    <Link
      href={`/dashboard/super-admin/call-analysis?leadId=${encodeURIComponent(leadId)}`}
      onClick={(e) => { e.stopPropagation(); onNavigate?.(); }}
      title={`${label ?? 'Call score'}: ${score} of ${max}${grade ? ` (${grade})` : ''}${calls} — open the call analysis`}
      className="inline-flex items-center gap-2 rounded-full ring-offset-background transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <ScoreRing pct={pct} label={grade} size={size} />
    </Link>
  );
}
