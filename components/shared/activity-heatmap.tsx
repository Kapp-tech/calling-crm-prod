'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DayCell {
  date: Date;
  key: string;
  count: number;
}

const LEVELS = [
  'bg-muted/70',
  'bg-emerald-200 dark:bg-emerald-900',
  'bg-emerald-400 dark:bg-emerald-700',
  'bg-emerald-500 dark:bg-emerald-600',
  'bg-emerald-600 dark:bg-emerald-500',
];

function levelFor(count: number): number {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * GitHub-style contribution heatmap of the user's feedback activity over the
 * last ~6 months. Fetches its own data; renders nothing while empty so it's
 * safe to mount for roles that never submit feedback.
 */
export function ActivityHeatmap() {
  const { data = [] } = useQuery<{ date: string; count: number }[]>({
    queryKey: ['activity-heatmap'],
    queryFn: async () => {
      const r = await fetch('/api/users/me/activity-heatmap');
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d) ? d : [];
    },
    staleTime: 5 * 60 * 1000,
  });

  const { weeks, total, best } = useMemo(() => {
    const countMap = new Map(data.map((d) => [d.date, d.count]));

    // Build day cells from 181 days ago through today, then pad the front so
    // the first column starts on a Sunday (GitHub layout: rows = Sun..Sat).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const startDay = new Date(today);
    startDay.setDate(startDay.getDate() - 181);
    startDay.setDate(startDay.getDate() - startDay.getDay());

    const days: DayCell[] = [];
    for (let d = new Date(startDay); d <= today; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0];
      days.push({ date: new Date(d), key, count: countMap.get(key) ?? 0 });
    }

    const weeks: DayCell[][] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

    return {
      weeks,
      total: data.reduce((s, d) => s + d.count, 0),
      best: Math.max(0, ...data.map((d) => d.count)),
    };
  }, [data]);

  if (total === 0) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-card p-4 sm:p-5">
      <div className="mb-1 flex items-center gap-2">
        <Activity className="h-4 w-4 text-emerald-500" />
        <h2 className="text-sm font-semibold">Activity</h2>
      </div>
      <p className="mb-4 text-xs text-muted-foreground">
        {total.toLocaleString()} feedbacks in the last 6 months · best day {best}
      </p>

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max flex-col gap-1">
          {/* Month labels — one per week column, shown where the month changes */}
          <div className="flex gap-[3px] text-[9px] leading-none text-muted-foreground">
            {weeks.map((week, i) => {
              const m = week[0]!.date.getMonth();
              const prev = i > 0 ? weeks[i - 1][0]!.date.getMonth() : -1;
              return (
                <span key={i} className="w-[11px]">
                  {m !== prev ? MONTHS[m] : ''}
                </span>
              );
            })}
          </div>
          <div className="flex gap-[3px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {week.map((day) => (
                  <div
                    key={day.key}
                    title={`${day.count} feedback${day.count !== 1 ? 's' : ''} · ${day.date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                    className={cn('h-[11px] w-[11px] rounded-[3px]', LEVELS[levelFor(day.count)])}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-end gap-1.5 text-[10px] text-muted-foreground">
        Less
        {LEVELS.map((l, i) => (
          <span key={i} className={cn('h-[10px] w-[10px] rounded-[3px]', l)} />
        ))}
        More
      </div>
    </div>
  );
}
