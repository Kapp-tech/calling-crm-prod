'use client';

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
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
  Receipt, GraduationCap,
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
  applications: number; admissions: number;
  connectedLeads: number; hotLeads: number; warmLeads: number;
  talktimeMinutes: number;
}
interface FeedbackItem { label: string; count: number }
interface TimelineItem { date: string; count: number }
interface SummaryData  {
  kpis: KPIs;
  /** Ids the cards need to build an All Leads link that lands on the same rows. */
  links: { connectedCategoryId: string | null; hotOptionId: string | null; warmOptionId: string | null };
  feedbackDistribution: FeedbackItem[];
  timeline: TimelineItem[];
  teams: { id: string; name: string; teamLeadId: string | null; leads: number }[];
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

function KpiCard({ label, value, sub, icon, color, loading, suffix, href, title }: {
  label: string; value: number; sub?: string; suffix?: string;
  icon: React.ReactNode; color: string; loading?: boolean;
  /** Where the card drills down to. Omitted makes the card a plain stat. */
  href?: string;
  title?: string;
}) {
  if (loading) return (
    <Card className="p-4 space-y-2">
      <Skel className="h-3 w-20" /><Skel className="h-7 w-14" /><Skel className="h-3 w-28" />
    </Card>
  );

  const card = (
    <Card
      className={cn(
        'relative h-full overflow-hidden transition-shadow hover:shadow-md',
        href && 'transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5',
      )}
    >
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
        {href && (
          <ArrowUpRight className="pointer-events-none absolute bottom-2 right-2 h-3.5 w-3.5 text-muted-foreground/30" />
        )}
      </CardContent>
    </Card>
  );

  // A plain stat stays a plain stat — no pointer, no hover lift — so nothing
  // invites a click that would go nowhere useful.
  if (!href) return card;
  return (
    <Link href={href} title={title} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
      {card}
    </Link>
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
  const fbDist   = data?.feedbackDistribution ?? [];
  const timeline = data?.timeline          ?? [];
  // Memoised: the `?? []` fallback is a new array each render, which would
  // rebuild leadsHref (and every card's href) on every render for nothing.
  const teams = useMemo(() => data?.teams ?? [], [data?.teams]);
  /**
   * Builds the All Leads link behind a card: this page's own filters, plus
   * whatever narrows it to that card's number.
   *
   * The date range carries over as the lead-created range, which is what it
   * means here. The team becomes a TL filter because that is the control All
   * Leads has — this page narrows on Lead.teamId, All Leads on the team's
   * leader, and since no TL leads two teams the two select the same rows.
   */
  const leadsHref = useCallback(
    (extra?: Record<string, string>) => {
      const p = new URLSearchParams();
      if (from) p.set('dateFrom', from);
      if (to) p.set('dateTo', to);
      const tl = teamId ? teams.find((t) => t.id === teamId)?.teamLeadId : null;
      if (tl) p.set('tlId', tl);
      for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
      const q = p.toString();
      return q ? `/dashboard/leads?${q}` : '/dashboard/leads';
    },
    [from, to, teamId, teams],
  );


  const exportSummary = useCallback(() => {
    if (!kpis) return;
    // The nine cards first, in the order they appear, so the file reads like
    // the screen. The pipeline figures below them no longer appear anywhere on
    // the page, but they stay in the export: they are the approval and
    // conversion counts someone downloading a summary still needs.
    const rows = [
      ['Metric','Value'],
      ['Total Leads', kpis.totalLeads],
      ['Assigned Leads', kpis.assigned],
      ['Applications', kpis.applications],
      ['Admissions', kpis.admissions],
      ['Connected Leads', kpis.connectedLeads],
      ['Untouched Leads', kpis.untouched],
      ['Hot Leads', kpis.hotLeads],
      ['Warm Leads', kpis.warmLeads],
      ['Talktime (min)', kpis.talktimeMinutes],
      ['—', ''],
      ['Pending', kpis.pendingApproval], ['Approved', kpis.approved],
      ['Unassigned', kpis.unassigned], ['Called', kpis.called],
      ['Feedbacks', kpis.totalFeedbacks], ['Interested', kpis.interested],
      ['Conversion Rate', kpis.conversionRate + '%'],
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
            Performance Analysis
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
      {/*
        Every card drills into the rows behind it. All Leads lists APPROVED and
        ASSIGNED leads only, so Total Leads is the one figure whose linked page
        shows fewer rows than the card — its sub-line names the gap rather than
        letting it look like a miscount.
      */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard loading={isLoading} label="Total Leads" value={kpis?.totalLeads ?? 0}
          sub={kpis && kpis.totalLeads > kpis.assigned
            ? `${fmt(kpis.totalLeads - kpis.assigned)} not on All Leads yet`
            : undefined}
          href={leadsHref()}
          title="Every lead in this period. All Leads lists the approved, assigned ones."
          icon={<Users className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />} color="bg-indigo-100 dark:bg-indigo-900/40" />

        <KpiCard loading={isLoading} label="Assigned Leads" value={kpis?.assigned ?? 0}
          sub={kpis ? `${pct(kpis.assigned, kpis.approved)}% of approved` : undefined}
          href={leadsHref()}
          title="Approved leads that sit with an agent — exactly what All Leads shows"
          icon={<UserCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />} color="bg-blue-100 dark:bg-blue-900/40" />

        <KpiCard loading={isLoading} label="Applications" value={kpis?.applications ?? 0}
          sub="approved receipts"
          href={leadsHref({ primaryAppConfirm: 'Yes' })}
          title="Approved APPLICATION receipts for leads in this period"
          icon={<Receipt className="h-4 w-4 text-violet-600 dark:text-violet-400" />} color="bg-violet-100 dark:bg-violet-900/40" />

        <KpiCard loading={isLoading} label="Admissions" value={kpis?.admissions ?? 0}
          sub="approved receipts"
          href={leadsHref({ primaryAdmConfirm: 'Yes' })}
          title="Approved ADMISSION receipts for leads in this period"
          icon={<GraduationCap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />} color="bg-emerald-100 dark:bg-emerald-900/40" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <KpiCard loading={isLoading} label="Connected Leads" value={kpis?.connectedLeads ?? 0}
          sub={kpis ? `${pct(kpis.connectedLeads, kpis.assigned)}% of assigned` : undefined}
          href={data?.links.connectedCategoryId
            ? leadsHref({ feedbackCategoryIds: data.links.connectedCategoryId })
            : undefined}
          title="Leads whose latest feedback is in the Connected category"
          icon={<PhoneCall className="h-4 w-4 text-teal-600 dark:text-teal-400" />} color="bg-teal-100 dark:bg-teal-900/40" />

        <KpiCard loading={isLoading} label="Untouched Leads" value={kpis?.untouched ?? 0}
          sub={kpis ? `${pct(kpis.untouched, kpis.assigned)}% of assigned` : undefined}
          href={leadsHref({ feedbackTab: 'fresh' })}
          title="Assigned leads with no follow-up logged yet"
          icon={<UserX className="h-4 w-4 text-orange-600 dark:text-orange-400" />} color="bg-orange-100 dark:bg-orange-900/40" />

        <KpiCard loading={isLoading} label="Hot Leads" value={kpis?.hotLeads ?? 0}
          href={data?.links.hotOptionId ? leadsHref({ feedbackOptionIds: data.links.hotOptionId }) : undefined}
          title="Leads whose latest feedback is Hot"
          icon={<TrendingUp className="h-4 w-4 text-rose-600 dark:text-rose-400" />} color="bg-rose-100 dark:bg-rose-900/40" />

        <KpiCard loading={isLoading} label="Warm Leads" value={kpis?.warmLeads ?? 0}
          href={data?.links.warmOptionId ? leadsHref({ feedbackOptionIds: data.links.warmOptionId }) : undefined}
          title="Leads whose latest feedback is Warm"
          icon={<TrendingUp className="h-4 w-4 text-amber-600 dark:text-amber-400" />} color="bg-amber-100 dark:bg-amber-900/40" />

        {/* Minutes, not leads — and counted by when the CALL happened, not when
            the lead was created, which is what every other card here means by
            the date range. Drills into Reports, where talk time is per agent. */}
        <KpiCard loading={isLoading} label="Talktime" value={kpis?.talktimeMinutes ?? 0} suffix=" min"
          sub="calls placed in this range"
          href="/dashboard/super-admin/reports"
          title="Total talk time from the dialer. Opens Reports, which breaks it down per agent."
          icon={<Clock className="h-4 w-4 text-sky-600 dark:text-sky-400" />} color="bg-sky-100 dark:bg-sky-900/40" />
      </div>

      {/* ── Uploads + Feedback mix ─────────────────────────────────────────── */}
      {/* The funnel, the status bar chart and the four rate cards used to sit
          here. They restated what the cards above already say, so they were
          removed rather than kept in a second voice. */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

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
      </div>

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
