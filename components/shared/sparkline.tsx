'use client';

import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tiny 7-day trend chart drawn along the bottom of a stat card.
 * Inherits its color from the parent via `currentColor`, so wrap it in a
 * span carrying a text-* class (we reuse the card's icon color).
 */
export function Sparkline({ data, className }: { data: number[]; className?: string }) {
  const gradId = useId();
  if (data.length < 2 || data.every((v) => v === 0)) return null;

  const W = 100;
  const H = 28;
  const max = Math.max(...data);
  const stepX = W / (data.length - 1);
  const points = data.map((v, i) => ({
    x: i * stepX,
    // leave 2px headroom top and bottom so the stroke never clips
    y: H - 2 - (v / max) * (H - 6),
  }));

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${W},${H} L0,${H} Z`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={cn('pointer-events-none h-full w-full', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.28" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
