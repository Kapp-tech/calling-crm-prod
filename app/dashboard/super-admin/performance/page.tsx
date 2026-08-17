'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Users, TrendingUp, PhoneCall, UserCheck, UserX, Clock,
  MessageSquare, Download, RefreshCw, BarChart3, Filter,
  ChevronUp, ChevronDown, ChevronsUpDown, ArrowUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { BreakdownRow } from '@/app/api/analytics/breakdown/route';

// ─── Types ────────────────────────────────────────────────────────────────────

interface KPIs {
  totalLeads: number; pendingApproval: number; disapproved: number;
  approved: number; assigned: number; unassigned: number;
  called: number; untouched: number; totalFeedbacks: number;
  interested: number; conversionRate: number;
}
interface FunnelStage  { stage: string; count: number; fill: string }
interface FeedbackItem { label: string; count: number }
interface TimelineItem { date: string; count: number }
interface SummaryData  {
  kpis: KPIs;
  funnel: FunnelStage[];
  feedbackDistribution: FeedbackItem[];
  timeline: TimelineItem[];
  teams: { id: string; name: string; leads: number }[];
}
type GroupBy = 'city' | 'state' | 'counsellor' | 'team' | 'college' | 'course' | 'feedback';
type SortKey = 'label' | 'total' | 'called' | 'untouched' | 'feedbacks' | 'convPct';
type SortDir = 'asc' | 'desc';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981',
  '#3b82f6','#ef4444','#14b8a6','#f97316','#84cc16',
];

const PIVOT_DIMS: { key: GroupBy; label: string }[] = [
  { key: 'city',       label: 'City'       },
  { key: 'state',      label: 'State'      },
  { key: 'counsellor', label: 'Counsellor' },
  { key: 'team',       label: 'Team'       },
  { key: 'college',    label: 'College'    },
  { key: 'course',     label: 'Course'     },
  { key: 'feedback',   label: 'Feedback'   },
];

const STATUS_BARS = (k: KPIs) => [
  { stage: 'Approved',   count: k.approved,        fill: '#10b981' },
  { stage: 'Assigned',   count: k.assigned,        fill: '#6366f1' },
  { stage: 'Called',     count: k.called,          fill: '#3b82f6' },
  { stage: 'Untouched',  count: k.untouched,       fill: '#f59e0b' },
  { stage: 'Interested', count: k.interested,      fill: '#8b5cf6' },
  { stage: 'Pending',    count: k.pendingApproval, fill: '#ef4444' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt  = (n: number) => n.toLocaleString('en-IN');
const pct  = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

function csvDownload(rows: BreakdownRow[], dim: string) {
  const header = 'Label,Total,Assigned,Called,Untouched,Feedbacks,Call%';
  const body   = rows.map((r) =>
    [r.label, r.total, r.assigned, r.called, r.untouched, r.feedbacks, r.convPct + '%'].join(',')
  );
  const blob = new Blob([[header, ...body].join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `breakdown_${dim}.csv` });
  a.click(); URL.revokeObjectURL(url);
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

const Skel = ({ className }: { className?: string }) => (
  <div className={cn('animate-pulse rounded-md bg-muted', className)} />
);

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, icon, color, loading, suffix }: {
  label: string; value: number; sub?: string; suffix?: string;
  icon: React.ReactNode; color: string; loading?: boolean;
}) {
  if (loading) return (
    <Card className="p-4 space-y-2">
      <Skel className="h-3 w-20" /><Skel className="h-7 w-14" /><Skel className="h-3 w-28" />
    </Card>
  );
  return (
    <Card className="relative overflow-hidden hover:shadow-md transition-shadow">
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-0.5 flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground truncate">{label}</p>
            <p className="text-2xl font-bold tabular-nums leading-tight">
              {fmt(value)}{suffix && <span className="text-base font-medium text-muted-foreground">{suffix}</span>}
            </p>
            {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={cn('p-2 rounded-xl shrink-0 ml-2', color)}>{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTip({ active, payload, label }: {
  active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg shadow-xl px-3 py-2 text-xs space-y-1 max-w-[180px]">
      {label && <p className="font-semibold text-foreground truncate">{label}</p>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full shrink-0" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold tabular-nums">{fmt(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Sort Header ──────────────────────────────────────────────────────────────

function SortTh({ col, label, sk, sd, onSort }: {
  col: SortKey; label: string; sk: SortKey; sd: SortDir; onSort: (k: SortKey) => void;
}) {
  const active = sk === col;
  return (
    <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-widest text-muted-foreground cursor-pointer select-none hover:text-foreground whitespace-nowrap"
      onClick={() => onSort(col)}>
      <span className="flex items-center gap-1">
        {label}
        {active ? (sd === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)
          : <ChevronsUpDown className="h-3 w-3 opacity-30" />}
      </span>
    </th>
  );
}

// ─── Mini progress bar ────────────────────────────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const w = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <span className="w-8 text-right tabular-nums text-xs text-foreground">{fmt(value)}</span>
      <div className="flex-1 bg-muted rounded-full h-1.5">
        <div className="h-1.5 rounded-full transition-all duration-300" style={{ width: `${w}%`, background: color }} />
      </div>
    </div>
  );
}

// ─── Pivot Table ──────────────────────────────────────────────────────────────

function PivotTable({ groupBy, from, to, teamId }: {
  groupBy: GroupBy; from: string; to: string; teamId: string;
}) {
  const [sk, setSk] = useState<SortKey>('total');
  const [sd, setSd] = useState<SortDir>('desc');

  const { data = [], isLoading } = useQuery<BreakdownRow[]>({
    queryKey: ['breakdown', groupBy, from, to, teamId],
    queryFn: () => {
      const p = new URLSearchParams({ groupBy });
      if (from)   p.set('from', from);
      if (to)     p.set('to', to);
      if (teamId) p.set('teamId', teamId);
      return fetch(`/api/analytics/breakdown?${p}`).then((r) => r.json());
    },
  });

  const onSort = (k: SortKey) => {
    setSd((d) => sk === k ? (d === 'asc' ? 'desc' : 'asc') : 'desc');
    setSk(k);
  };

  const sorted = useMemo(() => [...data].sort((a, b) => {
    const av = sk === 'label' ? a.label : a[sk as keyof BreakdownRow];
    const bv = sk === 'label' ? b.label : b[sk as keyof BreakdownRow];
    const cmp = typeof av === 'string' ? (av as string).localeCompare(bv as string) : (av as number) - (bv as number);
    return sd === 'asc' ? cmp : -cmp;
  }), [data, sk, sd]);

  const maxTotal = useMemo(() => Math.max(...data.map((r) => r.total), 1), [data]);
  const isFB = groupBy === 'feedback';
  const th   = { sk, sd, onSort };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {isLoading ? 'Loading…' : `${sorted.length} rows`}
        </p>
        <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs"
          disabled={data.length === 0} onClick={() => csvDownload(sorted, groupBy)}>
          <Download className="h-3 w-3" /> Export CSV
        </Button>
      </div>

      {isLoading
        ? <div className="space-y-2">{Array.from({length:5}).map((_,i) => <Skel key={i} className="h-10" />)}</div>
        : (
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <SortTh col="label"    label={PIVOT_DIMS.find((d) => d.key === groupBy)?.label ?? 'Label'} {...th} />
                    {!isFB && <SortTh col="total"    label="Total"     {...th} />}
                    {!isFB && <SortTh col="called"   label="Called"    {...th} />}
                    {!isFB && <SortTh col="untouched" label="Untouched" {...th} />}
                    <SortTh col="feedbacks" label="Feedbacks" {...th} />
                    {!isFB && <SortTh col="convPct" label="Call %" {...th} />}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sorted.length === 0 && (
                    <tr><td colSpan={6} className="py-10 text-center text-sm text-muted-foreground">No data for this dimension</td></tr>
                  )}
                  {sorted.map((row, i) => (
                    <tr key={i} className="hover:bg-muted/20 transition-colors">
                      <td className="px-3 py-2.5 font-medium">
                        {row.label}
                        {row.subLabel && <span className="ml-1.5 text-xs text-muted-foreground font-normal">({row.subLabel})</span>}
                      </td>
                      {!isFB && <td className="px-3 py-2.5"><MiniBar value={row.total}     max={maxTotal} color="#6366f1" /></td>}
                      {!isFB && <td className="px-3 py-2.5"><MiniBar value={row.called}    max={maxTotal} color="#10b981" /></td>}
                      {!isFB && <td className="px-3 py-2.5"><MiniBar value={row.untouched} max={maxTotal} color="#f59e0b" /></td>}
                      <td className="px-3 py-2.5 tabular-nums font-medium">{fmt(row.feedbacks)}</td>
                      {!isFB && (
                        <td className="px-3 py-2.5">
                          <span className={cn(
                            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
                            row.convPct >= 60 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400' :
                            row.convPct >= 30 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' :
                                               'bg-muted text-muted-foreground'
                          )}>
                            {row.convPct}%
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const [from,     setFrom]     = useState('');
  const [to,       setTo]       = useState('');
  const [teamId,   setTeamId]   = useState('');
  const [pivotDim, setPivotDim] = useState<GroupBy>('counsellor');

  const { data, isLoading, isFetching, refetch } = useQuery<SummaryData>({
    queryKey: ['analytics-summary', from, to, teamId],
    queryFn: () => {
      const p = new URLSearchParams();
      if (from)   p.set('from', from);
      if (to)     p.set('to', to);
      if (teamId) p.set('teamId', teamId);
      return fetch(`/api/analytics/summary?${p}`).then((r) => r.json());
    },
  });

  const kpis     = data?.kpis;
  const funnel   = data?.funnel            ?? [];
  const fbDist   = data?.feedbackDistribution ?? [];
  const timeline = data?.timeline          ?? [];
  const teams    = data?.teams             ?? [];

  const funnelBase = funnel[0]?.count ?? 1;

  const exportSummary = useCallback(() => {
    if (!kpis) return;
    const rows = [
      ['Metric','Value'],
      ['Total Leads', kpis.totalLeads], ['Pending', kpis.pendingApproval],
      ['Approved', kpis.approved], ['Assigned', kpis.assigned],
      ['Unassigned', kpis.unassigned], ['Called', kpis.called],
      ['Untouched', kpis.untouched], ['Feedbacks', kpis.totalFeedbacks],
      ['Interested', kpis.interested], ['Conversion Rate', kpis.conversionRate + '%'],
    ];
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'summary_report.csv' });
    a.click(); URL.revokeObjectURL(url);
  }, [kpis]);

  const timelineMax = useMemo(() => Math.max(...timeline.map((t) => t.count), 1), [timeline]);

  return (
    <div className="space-y-6 pb-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Reports &amp; Performance
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Full pipeline visibility — uploads, assignments, call activity &amp; conversion
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 h-9">
            <Filter className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="text-xs bg-transparent outline-none w-32 text-foreground" />
            <span className="text-muted-foreground text-xs">–</span>
            <input type="date" value={to} min={from||undefined} onChange={(e) => setTo(e.target.value)}
              className="text-xs bg-transparent outline-none w-32 text-foreground" />
          </div>
          {teams.length > 1 && (
            <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:ring-1 focus:ring-ring">
              <option value="">All Teams</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          )}
          <Button size="sm" variant="outline" className="h-9 gap-1.5"
            onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Refresh
          </Button>
          <Button size="sm" variant="outline" className="h-9 gap-1.5"
            onClick={exportSummary} disabled={!kpis}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </div>

      {/* ── KPI Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KpiCard loading={isLoading} label="Total Uploaded"    value={kpis?.totalLeads ?? 0}
          icon={<Users         className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />} color="bg-indigo-100 dark:bg-indigo-900/40" />
        <KpiCard loading={isLoading} label="Pending Approval"  value={kpis?.pendingApproval ?? 0}
          sub={kpis ? `${pct(kpis.pendingApproval, kpis.totalLeads)}% of total` : undefined}
          icon={<Clock         className="h-4 w-4 text-amber-600  dark:text-amber-400"  />} color="bg-amber-100  dark:bg-amber-900/40"  />
        <KpiCard loading={isLoading} label="Approved"          value={kpis?.approved ?? 0}
          sub={kpis ? `${pct(kpis.approved, kpis.totalLeads)}% of total` : undefined}
          icon={<UserCheck     className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />} color="bg-emerald-100 dark:bg-emerald-900/40" />
        <KpiCard loading={isLoading} label="Assigned"          value={kpis?.assigned ?? 0}
          sub={kpis ? `${pct(kpis.assigned, kpis.approved)}% of approved` : undefined}
          icon={<UserCheck     className="h-4 w-4 text-blue-600    dark:text-blue-400"    />} color="bg-blue-100    dark:bg-blue-900/40"    />
        <KpiCard loading={isLoading} label="Unassigned"        value={kpis?.unassigned ?? 0}
          sub={kpis ? `${pct(kpis.unassigned, kpis.approved)}% of approved` : undefined}
          icon={<UserX         className="h-4 w-4 text-rose-600    dark:text-rose-400"    />} color="bg-rose-100    dark:bg-rose-900/40"    />
        <KpiCard loading={isLoading} label="Called"            value={kpis?.called ?? 0}
          sub={kpis ? `${pct(kpis.called, kpis.assigned)}% of assigned` : undefined}
          icon={<PhoneCall     className="h-4 w-4 text-teal-600    dark:text-teal-400"    />} color="bg-teal-100    dark:bg-teal-900/40"    />
        <KpiCard loading={isLoading} label="Untouched"         value={kpis?.untouched ?? 0}
          sub={kpis ? `${pct(kpis.untouched, kpis.assigned)}% of assigned` : undefined}
          icon={<UserX         className="h-4 w-4 text-orange-600  dark:text-orange-400"  />} color="bg-orange-100  dark:bg-orange-900/40"  />
        <KpiCard loading={isLoading} label="Total Feedbacks"   value={kpis?.totalFeedbacks ?? 0}
          icon={<MessageSquare className="h-4 w-4 text-violet-600  dark:text-violet-400"  />} color="bg-violet-100  dark:bg-violet-900/40"  />
        <KpiCard loading={isLoading} label="Interested"        value={kpis?.interested ?? 0}
          sub={kpis ? `${pct(kpis.interested, kpis.called)}% of called` : undefined}
          icon={<TrendingUp    className="h-4 w-4 text-green-600   dark:text-green-400"   />} color="bg-green-100   dark:bg-green-900/40"   />
        <KpiCard loading={isLoading} label="Conversion Rate"   value={kpis?.conversionRate ?? 0} suffix="%"
          icon={<ArrowUpRight  className="h-4 w-4 text-sky-600     dark:text-sky-400"     />} color="bg-sky-100     dark:bg-sky-900/40"     />
      </div>

      {/* ── Funnel + Timeline ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Funnel */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lead Pipeline Funnel</CardTitle>
            <CardDescription>Conversion at each stage</CardDescription>
          </CardHeader>
          <CardContent className="pt-1">
            {isLoading ? <Skel className="h-64" /> : (
              <div className="space-y-3">
                {funnel.map((f, i) => {
                  const barW = funnelBase > 0 ? (f.count / funnelBase) * 100 : 0;
                  const p    = pct(f.count, funnelBase);
                  return (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">{f.stage}</span>
                        <span className="tabular-nums text-muted-foreground">
                          {fmt(f.count)}&nbsp;<span className="text-xs">({p}%)</span>
                        </span>
                      </div>
                      <div className="h-7 bg-muted rounded-md overflow-hidden">
                        <div className="h-full rounded-md flex items-center justify-end pr-2 text-white text-xs font-semibold transition-all duration-500"
                          style={{ width: `${Math.max(barW, 5)}%`, backgroundColor: f.fill }}>
                          {barW > 18 && p + '%'}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {funnel.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No data</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Upload Timeline */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lead Uploads Over Time</CardTitle>
            <CardDescription>
              Daily creation count {from && to ? `(${from} – ${to})` : '(last 60 days)'}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-1">
            {isLoading ? <Skel className="h-64" /> : timeline.length === 0
              ? <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No data in range</div>
              : (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={timeline} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}    />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v) => v.slice(5)} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} domain={[0, timelineMax + 1]} />
                    <Tooltip content={<ChartTip />} />
                    <Area type="monotone" dataKey="count" name="Leads"
                      stroke="#6366f1" fill="url(#aGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              )}
          </CardContent>
        </Card>
      </div>

      {/* ── Feedback Donut + Status Bars ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        {/* Feedback Donut */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Feedback Distribution</CardTitle>
            <CardDescription>Leads by their latest feedback</CardDescription>
          </CardHeader>
          <CardContent className="pt-1">
            {isLoading ? <Skel className="h-64" /> : fbDist.length === 0
              ? <div className="h-64 flex items-center justify-center text-sm text-muted-foreground">No feedbacks recorded</div>
              : (
                <div className="flex flex-col items-center gap-3">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie data={fbDist} cx="50%" cy="50%"
                        innerRadius={50} outerRadius={80}
                        dataKey="count" nameKey="label" paddingAngle={2}>
                        {fbDist.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<ChartTip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5 px-2">
                    {fbDist.map((f, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-xs">
                        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
                        <span className="text-muted-foreground max-w-[100px] truncate">{f.label}</span>
                        <span className="font-semibold tabular-nums">{fmt(f.count)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
          </CardContent>
        </Card>

        {/* Status bar chart */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Lead Status Breakdown</CardTitle>
            <CardDescription>Volume at each pipeline stage</CardDescription>
          </CardHeader>
          <CardContent className="pt-1">
            {isLoading || !kpis ? <Skel className="h-64" /> : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={STATUS_BARS(kpis)} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="stage" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="count" name="Leads" radius={[4,4,0,0]}>
                    {STATUS_BARS(kpis).map((s, i) => <Cell key={i} fill={s.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Rate Cards ─────────────────────────────────────────────────────── */}
      {kpis && !isLoading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Approval Rate',   value: pct(kpis.approved, kpis.totalLeads),  sub: `${fmt(kpis.approved)} / ${fmt(kpis.totalLeads)}`,   color: 'text-emerald-600 dark:text-emerald-400' },
            { label: 'Assignment Rate', value: pct(kpis.assigned, kpis.approved),    sub: `${fmt(kpis.assigned)} / ${fmt(kpis.approved)}`,     color: 'text-blue-600    dark:text-blue-400'    },
            { label: 'Call Rate',       value: pct(kpis.called, kpis.assigned),      sub: `${fmt(kpis.called)} / ${fmt(kpis.assigned)}`,       color: 'text-teal-600    dark:text-teal-400'    },
            { label: 'Interest Rate',   value: pct(kpis.interested, kpis.called),    sub: `${fmt(kpis.interested)} / ${fmt(kpis.called)}`,     color: 'text-violet-600  dark:text-violet-400'  },
          ].map((s, i) => (
            <Card key={i} className="p-4 hover:shadow-md transition-shadow">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{s.label}</p>
              <p className={cn('text-4xl font-black mt-1 tabular-nums leading-none', s.color)}>{s.value}%</p>
              <p className="text-xs text-muted-foreground mt-1.5">{s.sub} leads</p>
            </Card>
          ))}
        </div>
      )}

      {/* ── Pivot Breakdown ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Pivot Breakdown</CardTitle>
              <CardDescription>Drill into any dimension with sortable metrics and CSV export</CardDescription>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PIVOT_DIMS.map((d) => (
                <button key={d.key} onClick={() => setPivotDim(d.key)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-semibold transition-colors',
                    pivotDim === d.key
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground hover:bg-muted/60'
                  )}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <PivotTable groupBy={pivotDim} from={from} to={to} teamId={teamId} />
        </CardContent>
      </Card>

      {/* ── Team Distribution Bar ──────────────────────────────────────────── */}
      {teams.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Team Distribution</CardTitle>
            <CardDescription>Approved leads assigned per team</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? <Skel className="h-40" /> : (
              <ResponsiveContainer width="100%" height={Math.max(160, teams.length * 36)}>
                <BarChart layout="vertical" data={teams}
                  margin={{ top: 4, right: 40, left: 4, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="leads" name="Leads" fill="#6366f1" radius={[0,4,4,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
