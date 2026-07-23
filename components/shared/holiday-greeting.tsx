'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X, PartyPopper, Sparkles } from 'lucide-react';

interface Holiday {
  name: string;
  description?: string | null;
  type: string[];
}

// A handful of well-known Indian holidays get a fitting emoji; anything else
// (Calendarific lists dozens of minor regional observances) falls back to a
// generic celebration emoji rather than needing exhaustive curation.
const HOLIDAY_EMOJI: [string, string][] = [
  ['diwali', '🪔'], ['deepavali', '🪔'],
  ['holi', '🎨'],
  ['independence day', '🇮🇳'],
  ['republic day', '🇮🇳'],
  ['gandhi jayanti', '🕊️'],
  ['yoga day', '🧘'], ['yoga', '🧘'],
  ['christmas', '🎄'],
  ['eid', '🌙'],
  ['dussehra', '🏹'], ['vijayadashami', '🏹'], ['dashain', '🏹'],
  ['raksha bandhan', '🎗️'],
  ['new year', '🎆'],
  ['navratri', '💃'],
  ['ganesh chaturthi', '🐘'],
  ['makar sankranti', '🪁'], ['pongal', '🪁'],
  ['janmashtami', '🦚'],
  ['guru nanak', '📿'],
  ['baisakhi', '🌾'],
];

function emojiFor(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, emoji] of HOLIDAY_EMOJI) {
    if (lower.includes(key)) return emoji;
  }
  return '🎉';
}

// Scattered sparkle positions/timings — deliberately irregular (not evenly
// spaced, not synchronized) so the particles drift like something organic
// rather than a mechanical loop.
const PARTICLES = [
  { left: '6%', delay: '0s', duration: '4.2s' },
  { left: '20%', delay: '1.4s', duration: '5.1s' },
  { left: '38%', delay: '0.5s', duration: '4.6s' },
  { left: '58%', delay: '2.1s', duration: '5.4s' },
  { left: '74%', delay: '0.9s', duration: '4.4s' },
  { left: '90%', delay: '1.8s', duration: '5s' },
];

export function HolidayGreeting() {
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery<{ holiday: Holiday | null }>({
    queryKey: ['dashboard-greeting'],
    queryFn: () => fetch('/api/dashboard/greeting').then((r) => r.json()),
    staleTime: 60 * 60 * 1000,
  });

  const holiday = data?.holiday;
  if (!holiday || dismissed) return null;

  return (
    // Two layers because a Tailwind `animate-*` utility sets the whole
    // `animation` shorthand — the one-time entrance (fade-in-up, on this
    // outer div) and the continuous gradient loop (on the inner div) can't
    // both live on the same element.
    <div className="animate-fade-in-up relative overflow-hidden rounded-2xl text-white shadow-lg shadow-orange-500/25">
      <div
        className="absolute inset-0 animate-gradient-move motion-reduce:animate-none"
        style={{
          backgroundImage: 'linear-gradient(110deg, #fbbf24, #f97316, #ec4899, #f43f5e, #f97316, #fbbf24)',
          backgroundSize: '300% 300%',
        }}
      />

      {/* Floating sparkles drifting up through the banner */}
      {PARTICLES.map((p, i) => (
        <Sparkles
          key={i}
          aria-hidden
          className="pointer-events-none absolute bottom-2 h-3 w-3 text-white/80 animate-float-particle motion-reduce:hidden"
          style={{ left: p.left, animationDelay: p.delay, animationDuration: p.duration }}
        />
      ))}

      {/* Diagonal shimmer sweep */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 w-1/3 -skew-x-12 bg-gradient-to-r from-transparent via-white/25 to-transparent animate-shimmer-sweep motion-reduce:hidden"
      />

      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="absolute right-3 top-3 z-20 rounded-full p-1 text-white/80 transition-colors hover:bg-white/20 hover:text-white"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="relative z-10 flex items-center gap-3 px-5 py-4 pr-8 sm:px-6 sm:py-5">
        <span className="relative flex h-11 w-11 sm:h-12 sm:w-12 shrink-0 items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-white/40 blur-md animate-pulse-glow motion-reduce:hidden" />
          <span className="relative text-3xl sm:text-4xl leading-none" aria-hidden>{emojiFor(holiday.name)}</span>
        </span>
        <div className="min-w-0">
          <h3 className="text-base sm:text-xl font-bold leading-tight truncate">
            Happy {holiday.name}!
          </h3>
          <p className="mt-0.5 flex items-center gap-1 text-xs sm:text-sm text-white/90">
            <PartyPopper className="h-3.5 w-3.5 shrink-0" />
            Wishing you and your team a wonderful day.
          </p>
        </div>
      </div>
    </div>
  );
}
