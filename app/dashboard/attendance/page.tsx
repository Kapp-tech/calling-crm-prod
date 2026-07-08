'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock, ChevronDown, Check, Search, X, Loader2,
  Clock, Coffee, Gauge, Users, AlertCircle, RefreshCw, Utensils, Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentOption {
  id: string;
  name: string;
  role: 'COUNSELLING_AGENT' | 'COUNSELLING_TL';
  workType: 'WFH' | 'WFO';
}

type Status = 'NOT_PUNCHED_IN' | 'WORKING' | 'ON_BREAK' | 'PUNCHED_OUT';
type BreakCategory = 'LUNCH' | 'BIO' | 'TEA' | 'OTHER';

interface ReportRow {
  id: string;
  date: string;
  user: AgentOption;
  status: Status;
  punchInAt: string | null;
  punchOutAt: string | null;
  breakSeconds: number;
  breakSecondsByType: Record<BreakCategory, number>;
  idleSeconds: number;
  activeSeconds: number;
  autoClosed: boolean;
}

interface Filters {
  from: string;
  to: string;
  userIds: string[];
  workType: string;
}

function todayStr(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function formatDuration(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_META: Record<Status, { label: string; className: string }> = {
  NOT_PUNCHED_IN: { label: 'Not Punched In', className: 'bg-muted text-muted-foreground' },
  WORKING:        { label: 'Working',        className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  ON_BREAK:       { label: 'On Break',        className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400' },
  PUNCHED_OUT:    { label: 'Completed',       className: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};

// ─── Multi-select searchable Counsellor filter ─────────────────────────────────

function CounsellorMultiSelect({
  options, selected, onChange,
}: {
  options: AgentOption[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return !q ? options : options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((v) => v !== id) : [...selected, id]);
  }

  function label(id: string) {
    return options.find((o) => o.id === id)?.name ?? id;
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm shadow-sm transition-colors hover:border-primary/40"
      >
        <span className={cn('truncate text-left', selected.length === 0 && 'text-muted-foreground')}>
          {selected.length === 0
            ? 'All Counsellors'
            : selected.length === 1
            ? label(selected[0])
            : `${selected.length} selected`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-lg overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search counsellor…"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
            />
          </div>
          <ul className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
            )}
            {filtered.map((opt) => {
              const checked = selected.includes(opt.id);
              return (
                <li
                  key={opt.id}
                  onClick={() => toggle(opt.id)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-muted/50"
                >
                  <span className={cn(
                    'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-input',
                    checked && 'border-primary bg-primary'
                  )}>
                    {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </span>
                  <span className="truncate flex-1">{opt.name}</span>
                  <span className="text-[10px] text-muted-foreground">{opt.role === 'COUNSELLING_TL' ? 'TL' : 'Agent'}</span>
                </li>
              );
            })}
          </ul>
          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-t border-border px-2.5 py-1.5">
              {selected.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[11px] text-primary">
                  {label(id)}
                  <button type="button" onClick={(e) => { e.stopPropagation(); toggle(id); }} className="hover:text-destructive">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              <button type="button" onClick={() => onChange([])} className="ml-auto text-[11px] text-muted-foreground hover:text-destructive">
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AgentTimeBreakUpPage() {
  const today = todayStr();
  const [pending, setPending] = useState<Filters>({ from: today, to: today, userIds: [], workType: 'ALL' });
  const [applied, setApplied] = useState<Filters>({ from: today, to: today, userIds: [], workType: 'ALL' });

  const { data: agentOptions = [] } = useQuery<AgentOption[]>({
    queryKey: ['attendance-agents'],
    queryFn: () => fetch('/api/attendance/agents').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });

  const filteredAgentOptions = useMemo(() => {
    if (pending.workType === 'ALL') return agentOptions;
    return agentOptions.filter((a) => a.workType === pending.workType);
  }, [agentOptions, pending.workType]);

  const queryString = useMemo(() => {
    const p = new URLSearchParams({ from: applied.from, to: applied.to });
    if (applied.userIds.length > 0) p.set('userIds', applied.userIds.join(','));
    if (applied.workType !== 'ALL') p.set('workType', applied.workType);
    return p.toString();
  }, [applied]);

  const { data: rows = [], isLoading, isFetching, refetch } = useQuery<ReportRow[]>({
    queryKey: ['attendance-report', queryString],
    queryFn: () => fetch(`/api/attendance/report?${queryString}`).then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
  });

  function handleApply() {
    setApplied(pending);
  }
  function handleReset() {
    const reset = { from: today, to: today, userIds: [], workType: 'ALL' };
    setPending(reset);
    setApplied(reset);
  }

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        active: acc.active + r.activeSeconds,
        break: acc.break + r.breakSeconds,
        idle: acc.idle + r.idleSeconds,
        lunch: acc.lunch + (r.breakSecondsByType?.LUNCH ?? 0),
        bio: acc.bio + (r.breakSecondsByType?.BIO ?? 0),
        tea: acc.tea + (r.breakSecondsByType?.TEA ?? 0),
      }),
      { active: 0, break: 0, idle: 0, lunch: 0, bio: 0, tea: 0 }
    );
  }, [rows]);

  const dirty = pending.from !== applied.from || pending.to !== applied.to ||
    pending.userIds.join(',') !== applied.userIds.join(',') ||
    pending.workType !== applied.workType;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" /> Agent Time BreakUp
          </h1>
          <p className="text-sm text-muted-foreground">
            Punch In/Out, Break and Idle time for counsellors — filterable by counsellor and date range.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-1.5">
          <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {/* ── Filters ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">From date</Label>
              <Input
                type="date"
                value={pending.from}
                max={pending.to}
                onChange={(e) => setPending({ ...pending, from: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">To date</Label>
              <Input
                type="date"
                value={pending.to}
                min={pending.from}
                max={today}
                onChange={(e) => setPending({ ...pending, to: e.target.value })}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Type</Label>
              <Select value={pending.workType} onValueChange={(v) => setPending({ ...pending, workType: v, userIds: [] })}>
                <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Types</SelectItem>
                  <SelectItem value="WFH">WFH</SelectItem>
                  <SelectItem value="WFO">WFO</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 lg:col-span-2">
              <Label className="text-xs text-muted-foreground">Counsellor</Label>
              <CounsellorMultiSelect
                options={filteredAgentOptions}
                selected={pending.userIds}
                onChange={(v) => setPending({ ...pending, userIds: v })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" size="sm" onClick={handleReset}>Reset</Button>
            <Button size="sm" onClick={handleApply} disabled={!dirty}>Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Summary stats ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Active Time</p>
              <p className="text-lg font-bold tabular-nums">{formatDuration(totals.active)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
              <Coffee className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Break Time</p>
              <p className="text-lg font-bold tabular-nums">{formatDuration(totals.break)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-500/10 text-slate-600">
              <Gauge className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total Idle Time</p>
              <p className="text-lg font-bold tabular-nums">{formatDuration(totals.idle)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Break breakdown ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 text-orange-600">
              <Utensils className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Lunch Break</p>
              <p className="text-lg font-bold tabular-nums">{formatDuration(totals.lunch)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/10 text-violet-600">
              <Timer className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Bio Break</p>
              <p className="text-lg font-bold tabular-nums">{formatDuration(totals.bio)}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 pt-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600">
              <Coffee className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tea Break</p>
              <p className="text-lg font-bold tabular-nums">{formatDuration(totals.tea)}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
            <Users className="h-4 w-4 text-muted-foreground" /> Attendance Records
            <span className="text-xs font-normal text-muted-foreground">({rows.length})</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <CalendarClock className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No attendance records found for this filter.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Counsellor</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Punch In</TableHead>
                  <TableHead>Punch Out</TableHead>
                  <TableHead>Active Hours</TableHead>
                  <TableHead>Break Time</TableHead>
                  <TableHead>Lunch</TableHead>
                  <TableHead>Bio</TableHead>
                  <TableHead>Tea</TableHead>
                  <TableHead>Idle Time</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{r.user.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {r.user.role === 'COUNSELLING_TL' ? 'Team Lead' : 'Agent'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{r.date}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatTime(r.punchInAt)}</TableCell>
                    <TableCell className="text-sm tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        {formatTime(r.punchOutAt)}
                        {r.autoClosed && (
                          <span title="Auto-closed — no explicit punch-out was recorded">
                            <AlertCircle className="h-3 w-3 text-amber-500" />
                          </span>
                        )}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm font-medium tabular-nums">{formatDuration(r.activeSeconds)}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatDuration(r.breakSeconds)}</TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">{formatDuration(r.breakSecondsByType?.LUNCH ?? 0)}</TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">{formatDuration(r.breakSecondsByType?.BIO ?? 0)}</TableCell>
                    <TableCell className="text-sm tabular-nums text-muted-foreground">{formatDuration(r.breakSecondsByType?.TEA ?? 0)}</TableCell>
                    <TableCell className="text-sm tabular-nums">{formatDuration(r.idleSeconds)}</TableCell>
                    <TableCell>
                      <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_META[r.status].className)}>
                        {STATUS_META[r.status].label}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
