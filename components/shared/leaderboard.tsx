'use client';

import { motion } from 'framer-motion';
import { Crown, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LeaderboardAgent {
  name: string;
  callCount: number;
  todayCount: number;
}

const MEDAL = [
  { ring: 'ring-amber-400',  bg: 'bg-gradient-to-br from-amber-400 to-yellow-500',  bar: 'from-amber-400 to-yellow-500',  height: 'h-20 sm:h-24', label: '1st' },
  { ring: 'ring-slate-300',  bg: 'bg-gradient-to-br from-slate-400 to-slate-500',   bar: 'from-slate-400 to-slate-500',   height: 'h-14 sm:h-16', label: '2nd' },
  { ring: 'ring-orange-300', bg: 'bg-gradient-to-br from-orange-400 to-amber-600',  bar: 'from-orange-400 to-amber-600',  height: 'h-10 sm:h-12', label: '3rd' },
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

function PodiumSpot({ agent, rank, delay }: { agent: LeaderboardAgent; rank: 0 | 1 | 2; delay: number }) {
  const m = MEDAL[rank];
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, type: 'spring', stiffness: 260, damping: 22 }}
      className="flex flex-1 min-w-0 flex-col items-center gap-1.5"
    >
      <div className="relative">
        {rank === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6, rotate: -12 }}
            animate={{ opacity: 1, y: 0, rotate: 0 }}
            transition={{ delay: delay + 0.25, type: 'spring', stiffness: 300, damping: 15 }}
            className="absolute -top-5 left-1/2 -translate-x-1/2"
          >
            <Crown className="h-5 w-5 fill-amber-400 text-amber-500" />
          </motion.div>
        )}
        <div
          className={cn(
            'flex items-center justify-center rounded-full text-white font-bold ring-2 ring-offset-2 ring-offset-card shadow-lg',
            m.ring, m.bg,
            rank === 0 ? 'h-14 w-14 text-lg' : 'h-11 w-11 text-sm',
          )}
        >
          {initials(agent.name)}
        </div>
      </div>
      <p className="w-full truncate text-center text-xs font-semibold" title={agent.name}>{agent.name}</p>
      <p className="text-sm font-bold tabular-nums leading-none">{agent.callCount}</p>
      {agent.todayCount > 0 && (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-orange-600">
          <Flame className="h-2.5 w-2.5" /> {agent.todayCount} today
        </span>
      )}
      <div className={cn('w-full max-w-[88px] rounded-t-lg bg-gradient-to-t opacity-80', m.bar, m.height)}>
        <p className="pt-1.5 text-center text-[10px] font-bold text-white/90">{m.label}</p>
      </div>
    </motion.div>
  );
}

/** Podium (top 3) + progress-bar rows (4th, 5th) for the dashboard's Top Performers card. */
export function Leaderboard({ agents }: { agents: LeaderboardAgent[] }) {
  if (agents.length === 0) return null;
  const max = Math.max(...agents.map((a) => a.callCount), 1);
  const [first, second, third, ...rest] = agents;

  return (
    <div className="space-y-4">
      {/* Podium — 2nd | 1st | 3rd */}
      <div className="flex items-end gap-2 sm:gap-4 pt-5">
        {second ? <PodiumSpot agent={second} rank={1} delay={0.12} /> : <div className="flex-1" />}
        <PodiumSpot agent={first} rank={0} delay={0} />
        {third ? <PodiumSpot agent={third} rank={2} delay={0.2} /> : <div className="flex-1" />}
      </div>

      {/* Runners-up */}
      {rest.length > 0 && (
        <div className="space-y-2 border-t border-border/60 pt-3">
          {rest.map((agent, i) => (
            <motion.div
              key={agent.name}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.08 }}
              className="flex items-center gap-3"
            >
              <span className="w-5 text-center text-xs font-bold text-muted-foreground">{i + 4}</span>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                {initials(agent.name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="truncate text-xs font-medium">{agent.name}</p>
                  <p className="shrink-0 text-xs font-bold tabular-nums">
                    {agent.callCount}
                    {agent.todayCount > 0 && (
                      <span className="ml-1.5 font-semibold text-orange-600">+{agent.todayCount} today</span>
                    )}
                  </p>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(agent.callCount / max) * 100}%` }}
                    transition={{ delay: 0.4 + i * 0.08, duration: 0.6, ease: 'easeOut' }}
                    className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-violet-500"
                  />
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
