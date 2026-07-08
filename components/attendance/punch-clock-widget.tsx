'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, Coffee, LogIn, LogOut, Play, AlertCircle, Utensils, Timer } from 'lucide-react';
import { cn } from '@/lib/utils';

const IDLE_THRESHOLD_MS = 60_000; // must match lib/attendance.ts IDLE_THRESHOLD_SECONDS
const HEARTBEAT_INTERVAL_MS = 20_000; // must match lib/attendance.ts HEARTBEAT_INTERVAL_SECONDS
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'] as const;

type Status = 'NOT_PUNCHED_IN' | 'WORKING' | 'ON_BREAK' | 'PUNCHED_OUT';
type BreakType = 'LUNCH' | 'BIO' | 'TEA';
type BreakCategory = BreakType | 'OTHER';

const BREAK_TYPE_META: Record<BreakType, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  LUNCH: { label: 'Lunch Break', icon: Utensils },
  BIO:   { label: 'Bio Break',   icon: Timer },
  TEA:   { label: 'Tea Break',   icon: Coffee },
};

const BREAK_CATEGORY_LABEL: Record<BreakCategory, string> = {
  LUNCH: 'Lunch Break', BIO: 'Bio Break', TEA: 'Tea Break', OTHER: 'Break',
};

interface AttendanceSummary {
  status: Status;
  punchInAt: string | null;
  punchOutAt: string | null;
  breakSeconds: number;
  breakSecondsByType: Record<BreakCategory, number>;
  idleSeconds: number;
  activeSeconds: number;
  autoClosed: boolean;
  currentBreakStartAt: string | null;
  currentBreakType: BreakCategory | null;
}

function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function PunchClockWidget() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pickingBreakType, setPickingBreakType] = useState(false);
  const [, setTick] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Seconds accrued locally since the last successful heartbeat — the
  // single source of truth for "uncommitted" active/idle time on screen.
  const accumulatorRef = useRef({ active: 0, idle: 0 });
  const lastActivityRef = useRef(Date.now());

  const role = session?.user?.role;
  const eligible = role === 'COUNSELLING_AGENT' || role === 'COUNSELLING_TL';

  const { data: summary, dataUpdatedAt } = useQuery<AttendanceSummary>({
    queryKey: ['attendance-me'],
    queryFn: () => fetch('/api/attendance/me').then((r) => r.json()),
    enabled: eligible,
    refetchOnWindowFocus: true,
  });

  // 1-second display tick so the live timers visibly count up.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Reset the break-type picker whenever the dropdown closes or the shift
  // is no longer in a state where "Take Break" applies.
  useEffect(() => {
    if (!open || summary?.status !== 'WORKING') setPickingBreakType(false);
  }, [open, summary?.status]);

  const isWorking = summary?.status === 'WORKING';

  // The one tick that actually decides what counts as Active vs Idle.
  // Gated on document.visibilityState — if the tab is hidden (backgrounded,
  // minimized, or closed) this simply returns without touching either
  // counter, so that time is never measured at all, in either direction.
  // Whenever the tab IS visible, any real input resets the "last activity"
  // clock; once a full minute passes with none, every subsequent visible
  // second goes to Idle instead of Active.
  useEffect(() => {
    if (!isWorking) return;

    lastActivityRef.current = Date.now();
    function onActivity() { lastActivityRef.current = Date.now(); }
    ACTIVITY_EVENTS.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));

    const tick = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const isIdleNow = Date.now() - lastActivityRef.current >= IDLE_THRESHOLD_MS;
      if (isIdleNow) accumulatorRef.current.idle += 1;
      else accumulatorRef.current.active += 1;
    }, 1000);

    return () => {
      ACTIVITY_EVENTS.forEach((evt) => window.removeEventListener(evt, onActivity));
      clearInterval(tick);
    };
  }, [isWorking]);

  const heartbeatMutation = useMutation({
    mutationFn: (delta: { activeDeltaSeconds: number; idleDeltaSeconds: number }) =>
      fetch('/api/attendance/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(delta),
      }).then((r) => r.json()),
    onSuccess: (data) => qc.setQueryData(['attendance-me'], data),
  });

  async function flushHeartbeat() {
    if (!isWorking) return;
    const { active, idle } = accumulatorRef.current;
    if (active === 0 && idle === 0) return;
    accumulatorRef.current = { active: 0, idle: 0 };
    try {
      await heartbeatMutation.mutateAsync({ activeDeltaSeconds: active, idleDeltaSeconds: idle });
    } catch {
      // Best-effort — losing this partial window's attribution is the safe
      // (under-count) direction rather than over-counting.
    }
  }

  // Regular flush every interval while working...
  useEffect(() => {
    if (!isWorking) return;
    const id = setInterval(() => { void flushHeartbeat(); }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorking]);

  // ...plus an immediate flush the moment the tab is backgrounded, so
  // switching away doesn't strand up to one whole interval's worth of
  // already-accrued active time until the next scheduled tick.
  useEffect(() => {
    if (!isWorking) return;
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        // Don't let time spent hidden retroactively count as idle.
        lastActivityRef.current = Date.now();
      } else {
        void flushHeartbeat();
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWorking]);

  // Final best-effort flush on actual tab close / navigation away. A normal
  // fetch can get cancelled mid-flight when the page unloads — sendBeacon is
  // built specifically to survive that.
  useEffect(() => {
    if (!isWorking) return;
    function onPageHide() {
      const { active, idle } = accumulatorRef.current;
      if (active === 0 && idle === 0) return;
      accumulatorRef.current = { active: 0, idle: 0 };
      const blob = new Blob(
        [JSON.stringify({ activeDeltaSeconds: active, idleDeltaSeconds: idle })],
        { type: 'application/json' }
      );
      navigator.sendBeacon('/api/attendance/heartbeat', blob);
    }
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, [isWorking]);

  function action(url: string) {
    return fetch(url, { method: 'POST' }).then(async (r) => {
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Action failed');
      return json as AttendanceSummary;
    });
  }

  const punchInMutation = useMutation({
    mutationFn: () => action('/api/attendance/punch-in'),
    onSuccess: (data) => qc.setQueryData(['attendance-me'], data),
  });
  const punchOutMutation = useMutation({
    mutationFn: () => action('/api/attendance/punch-out'),
    onSuccess: (data) => { accumulatorRef.current = { active: 0, idle: 0 }; qc.setQueryData(['attendance-me'], data); },
  });
  const breakStartMutation = useMutation({
    mutationFn: (type: BreakType) =>
      fetch('/api/attendance/break/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      }).then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Action failed');
        return json as AttendanceSummary;
      }),
    onSuccess: (data) => {
      accumulatorRef.current = { active: 0, idle: 0 };
      qc.setQueryData(['attendance-me'], data);
      setPickingBreakType(false);
    },
  });
  const breakEndMutation = useMutation({
    mutationFn: () => action('/api/attendance/break/end'),
    onSuccess: (data) => qc.setQueryData(['attendance-me'], data),
  });

  // Flush whatever partial window is pending before transitioning out of
  // WORKING, so the last few (sub-interval) seconds before a break or
  // punch-out still get attributed instead of silently dropped.
  function handleTakeBreak() {
    setPickingBreakType(true);
  }
  async function handleSelectBreakType(type: BreakType) {
    await flushHeartbeat();
    breakStartMutation.mutate(type);
  }
  async function handlePunchOut() {
    await flushHeartbeat();
    punchOutMutation.mutate();
  }

  if (!eligible || !summary) return null;

  // Active/Idle are simply the last server-confirmed totals plus whatever
  // this tab has accrued locally since the last flush — both sides already
  // account for visibility, so no further wall-clock extrapolation is
  // needed (or correct) here. Break time has no heartbeat of its own, so it
  // still extrapolates from elapsed time, which is fine — a break is a
  // deliberate, explicit action with a real start timestamp regardless of
  // tab visibility.
  const secondsSinceFetch = dataUpdatedAt ? (Date.now() - dataUpdatedAt) / 1000 : 0;

  const liveActive = summary.activeSeconds + accumulatorRef.current.active;
  const liveIdle = summary.idleSeconds + accumulatorRef.current.idle;
  const liveBreak = summary.status === 'ON_BREAK'
    ? summary.breakSeconds + secondsSinceFetch
    : summary.breakSeconds;

  const STATUS_META: Record<Status, { label: string; dot: string }> = {
    NOT_PUNCHED_IN: { label: 'Not Punched In', dot: 'bg-muted-foreground/40' },
    WORKING:        { label: 'Working',        dot: 'bg-emerald-500' },
    ON_BREAK:       { label: 'On Break',        dot: 'bg-amber-500' },
    PUNCHED_OUT:    { label: 'Shift Complete',  dot: 'bg-slate-400' },
  };
  const onBreakLabel = summary.currentBreakType ? BREAK_CATEGORY_LABEL[summary.currentBreakType] : 'On Break';
  const meta = { ...STATUS_META[summary.status], label: summary.status === 'ON_BREAK' ? onBreakLabel : STATUS_META[summary.status].label };

  // The hero number always reflects whichever timer is actually ticking
  // right now — Break time while on a break, Active time otherwise — so the
  // agent never sees a frozen "Active Time" while on a break.
  const heroIsBreak = summary.status === 'ON_BREAK';
  const headlinePill = heroIsBreak ? liveBreak : liveActive;
  const heroLabel = heroIsBreak ? onBreakLabel : 'Active Time';
  const heroValue = heroIsBreak ? liveBreak : liveActive;
  const heroColor = heroIsBreak ? 'text-amber-600 dark:text-amber-400' : 'text-foreground';

  const busy = punchInMutation.isPending || punchOutMutation.isPending || breakStartMutation.isPending || breakEndMutation.isPending;
  const errorMsg = (punchInMutation.error ?? punchOutMutation.error ?? breakStartMutation.error ?? breakEndMutation.error) as Error | null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-2 rounded-full border border-border bg-background px-3 h-9 text-xs font-semibold transition-colors hover:bg-muted',
          open && 'bg-muted'
        )}
      >
        <span className={cn('h-2 w-2 rounded-full', meta.dot, summary.status === 'WORKING' && 'animate-pulse')} />
        <span className="hidden sm:inline">{meta.label}</span>
        {summary.status !== 'NOT_PUNCHED_IN' && (
          <span className="tabular-nums text-muted-foreground">{formatHMS(headlinePill)}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-[300px] overflow-hidden rounded-xl border border-border bg-background shadow-2xl ring-1 ring-black/5 dark:ring-white/5">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-muted-foreground" /> Punch Clock
            </span>
            <span className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold',
              summary.status === 'WORKING'  && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
              summary.status === 'ON_BREAK' && 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
              summary.status === 'PUNCHED_OUT' && 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
              summary.status === 'NOT_PUNCHED_IN' && 'bg-muted text-muted-foreground',
            )}>
              <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} /> {meta.label}
            </span>
          </div>

          <div className="px-4 py-4 space-y-3">
            {summary.autoClosed && (
              <div className="flex items-start gap-1.5 rounded-md bg-amber-500/10 border border-amber-300/40 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                Your previous shift was auto-closed because no punch-out was recorded.
              </div>
            )}

            <div className="text-center py-2">
              <p className={cn('text-[10px] font-bold uppercase tracking-widest', heroIsBreak ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
                {heroLabel}
              </p>
              <p className={cn('text-3xl font-bold tabular-nums tracking-tight', heroColor)}>{formatHMS(heroValue)}</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {heroIsBreak ? 'Active' : 'Break'}
                </p>
                <p className="text-sm font-bold tabular-nums">{formatHMS(heroIsBreak ? liveActive : liveBreak)}</p>
              </div>
              <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-center">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Idle</p>
                <p className="text-sm font-bold tabular-nums">{formatHMS(liveIdle)}</p>
              </div>
            </div>

            {summary.punchInAt && (
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Punched in</span>
                <span className="font-medium text-foreground">
                  {new Date(summary.punchInAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}
            {summary.punchOutAt && (
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>Punched out</span>
                <span className="font-medium text-foreground">
                  {new Date(summary.punchOutAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )}

            {errorMsg && (
              <p className="text-[11px] font-medium text-destructive">{errorMsg.message}</p>
            )}

            {summary.status === 'WORKING' && pickingBreakType && (
              <div className="space-y-1.5 pt-1">
                <p className="text-[11px] font-semibold text-muted-foreground">Select a break type</p>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(BREAK_TYPE_META) as BreakType[]).map((type) => {
                    const { label, icon: Icon } = BREAK_TYPE_META[type];
                    return (
                      <button
                        key={type}
                        disabled={busy}
                        onClick={() => handleSelectBreakType(type)}
                        className="flex flex-col items-center justify-center gap-1 rounded-lg border border-amber-300/60 bg-amber-500/10 px-2 py-2.5 text-center text-[11px] font-semibold text-amber-700 dark:text-amber-400 transition-all hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        <Icon className="h-4 w-4" />
                        {label}
                      </button>
                    );
                  })}
                </div>
                <button
                  disabled={busy}
                  onClick={() => setPickingBreakType(false)}
                  className="w-full rounded-lg px-3 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              {summary.status === 'NOT_PUNCHED_IN' && (
                <button
                  disabled={busy}
                  onClick={() => punchInMutation.mutate()}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
                >
                  <LogIn className="h-3.5 w-3.5" /> Punch In
                </button>
              )}
              {summary.status === 'WORKING' && !pickingBreakType && (
                <>
                  <button
                    disabled={busy}
                    onClick={handleTakeBreak}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-300/60 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-400 transition-all hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    <Coffee className="h-3.5 w-3.5" /> Take Break
                  </button>
                  <button
                    disabled={busy}
                    onClick={handlePunchOut}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground shadow-sm transition-all hover:bg-destructive/90 disabled:opacity-50"
                  >
                    <LogOut className="h-3.5 w-3.5" /> Punch Out
                  </button>
                </>
              )}
              {summary.status === 'ON_BREAK' && (
                <button
                  disabled={busy}
                  onClick={() => breakEndMutation.mutate()}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 disabled:opacity-50"
                >
                  <Play className="h-3.5 w-3.5" /> Resume
                </button>
              )}
              {summary.status === 'PUNCHED_OUT' && (
                <p className="flex-1 text-center text-xs text-muted-foreground py-1">
                  Shift complete for today. See you tomorrow!
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
