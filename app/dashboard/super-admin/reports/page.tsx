'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { BarChart3, Loader2, Download, Users, Info, GraduationCap, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MultiSelectFilter } from '@/components/shared/multi-select-filter';
import { cn } from '@/lib/utils';
import { istDayKey } from '@/lib/ist-time';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Row {
  id: string; employeeCode: string | null; name: string;
  tl: string | null; manager: string | null; zone: string | null; language: string | null;
  joiningDate: string | null; dialedCalls: number; connectedCalls: number; notConnectedCalls: number;
  applications: number; admissions: number; avgTalktimeMin: number | null;
}

interface ReportResponse {
  view: 'agent' | 'team' | 'manager';
  range: string;
  label: string;
  rows: Row[];
  summary: {
    totalAgents: number; dialedCalls: number; connectedCalls: number; notConnectedCalls: number;
    applications: number; admissions: number;
  };
  feedbackBreakdown: {
    universities: number;
    total: number;
    rows: { feedback: string; category: string | null; leads: number }[];
    label: string;
  };
  collegeBreakdown: {
    label: string;
    availableOutcomes: string[];
    rows: {
      college: string; dialed: number; connected: number; notConnected: number; other: number;
      connectedPct: number | null; outcomes: Record<string, number>;
    }[];
    totals: {
      dialed: number; connected: number; notConnected: number; other: number;
      connectedPct: number | null; outcomes: Record<string, number>;
    };
  };
  benchmarking: { kpi: string; unit: string; period: string; target: number; actual: number | null; pct: number | null }[];
  choices: { agents: { id: string; name: string; employeeCode: string | null }[]; tls: { id: string; name: string }[] };
}

const SELECT =
  'h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * Rows are tinted by the admin-maintained feedback category, not by a hardcoded
 * list of "good" outcomes — that way the colouring follows Manage Feedbacks and
 * matches the pills on All Leads instead of drifting from them.
 */
function categoryTone(category: string | null): string {
  const c = (category ?? '').toLowerCase();
  // Stronger in dark: a /10 wash over a near-black surface is invisible, and the
  // tint is the only at-a-glance signal of the category besides the tooltip.
  if (c === 'connected') return 'bg-emerald-500/10 dark:bg-emerald-500/[0.16]';
  if (c === 'not connected') return 'bg-red-500/[0.06] dark:bg-red-500/[0.13]';
  if (c === 'warm') return 'bg-amber-500/10 dark:bg-amber-500/[0.16]';
  if (c === 'cold') return 'bg-sky-500/10 dark:bg-sky-500/[0.16]';
  return '';
}

/**
 * Outcome columns shown by default — the ones the spreadsheet this replaces
 * tracked. Matched by label and skipped when absent, so renaming or deleting a
 * feedback option degrades to a missing column rather than a crash. If none of
 * them exist the report falls back to the busiest outcomes, so it is never
 * blank for an organisation using different labels.
 */
const DEFAULT_OUTCOME_COLUMNS = ['Walk-In', 'Application Done', 'Admission Done', 'Cold', 'Interested'];

function pctTone(pct: number | null) {
  if (pct === null) return 'text-muted-foreground';
  if (pct >= 100) return 'text-emerald-600 dark:text-emerald-400';
  if (pct >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-500';
}

export default function ReportsPage() {
  const { data: session } = useSession();
  const today = istDayKey(new Date());

  const [range, setRange] = useState<'DATEWISE' | 'WEEKLY' | 'OVERALL'>('DATEWISE');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [tlIds, setTlIds] = useState<string[]>([]);

  const { data, isLoading, isFetching } = useQuery<ReportResponse>({
    queryKey: ['agent-report', range, from, to, agentIds, tlIds],
    queryFn: () => {
      const p = new URLSearchParams({ range });
      if (range === 'DATEWISE') { p.set('from', from); p.set('to', to); }
      if (agentIds.length) p.set('agentIds', agentIds.join(','));
      if (tlIds.length) p.set('tlIds', tlIds.join(','));
      return fetch(`/api/reports/agent-performance?${p}`).then((r) => r.json());
    },
    enabled: !!session?.user?.id,
    placeholderData: (prev) => prev,
  });

  const view = data?.view ?? 'agent';
  const rows = data?.rows ?? [];

  // The agent list the server sends already follows the TL filter. Anyone still
  // selected who has dropped off it is cleared, so the filter bar can never show
  // a chip for an agent the report is no longer able to include.
  const agentOptions = useMemo(
    () => (data?.choices.agents ?? []).map((a) => ({
      value: a.id,
      label: a.employeeCode ? `${a.name} · ${a.employeeCode}` : a.name,
    })),
    [data?.choices.agents],
  );

  useEffect(() => {
    if (!data) return;
    const allowed = new Set(data.choices.agents.map((a) => a.id));
    setAgentIds((cur) => (cur.every((id) => allowed.has(id)) ? cur : cur.filter((id) => allowed.has(id))));
  }, [data]);

  function exportCsv() {
    if (!data) return;
    const head = [
      'Agent ID', 'Agent Name', 'Agent TL', 'Agent Manager', 'Joining Date', 'Agent Zone', 'Agent Language',
      'Total Dialed Calls', 'Total Connected Calls', 'Total Not Connected Calls',
      'Total Application', 'Total Admission', 'Average Talktime (min)',
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = rows.map((r) => [
      // ISO in the export so it sorts and filters properly in Excel.
      r.employeeCode ?? '', r.name, r.tl ?? '', r.manager ?? '', r.joiningDate ?? '', r.zone ?? '', r.language ?? '',
      r.dialedCalls, r.connectedCalls, r.notConnectedCalls, r.applications, r.admissions,
      r.avgTalktimeMin ?? '',
    ].map(esc).join(','));
    const blob = new Blob([[head.map(esc).join(','), ...body].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `performance_${data.label.replace(/\W+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /**
   * Two columns, in the same order as on screen, so it drops straight into the
   * spreadsheet this table replaces: the university count on top, one row per
   * outcome, the total at the foot.
   */
  function exportFeedbackCsv() {
    const fb = data?.feedbackBreakdown;
    if (!fb) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['University/Institution Count', fb.universities],
      ...fb.rows.map((r) => [r.feedback, r.leads]),
      ['Total', fb.total],
    ].map((cells) => cells.map(esc).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `feedback_summary_${fb.label.replace(/\W+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // Which outcome columns the college table shows. Held here rather than sent to
  // the server: every outcome's per-college count is already in the response, so
  // changing columns is instant and costs no query.
  const [outcomeCols, setOutcomeCols] = useState<string[] | null>(null);
  // Memoised so the `?? []` fallback does not mint a fresh array every render,
  // which would make the memo below recompute each time for nothing.
  const available = useMemo(
    () => data?.collegeBreakdown.availableOutcomes ?? [],
    [data?.collegeBreakdown.availableOutcomes],
  );
  const shownOutcomes = useMemo(() => {
    if (outcomeCols) return outcomeCols.filter((o) => available.includes(o));
    const preferred = DEFAULT_OUTCOME_COLUMNS.filter((o) => available.includes(o));
    return preferred.length > 0 ? preferred : available.slice(0, 5);
  }, [outcomeCols, available]);

  // Only surfaced when some lead actually landed outside both categories, so a
  // normal two-category setup never sees an always-zero column.
  const showOther = (data?.collegeBreakdown.totals.other ?? 0) > 0;

  function exportCollegeCsv() {
    const cb = data?.collegeBreakdown;
    if (!cb) return;
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = [
      'University Name', 'Dialed', 'Connected', 'Connected %', 'Not Connected',
      ...(showOther ? ['Other'] : []), ...shownOutcomes,
    ];
    const line = (name: string, r: typeof cb.totals) => [
      name, r.dialed, r.connected, r.connectedPct === null ? '' : `${r.connectedPct}%`, r.notConnected,
      ...(showOther ? [r.other] : []),
      ...shownOutcomes.map((o) => r.outcomes[o] ?? 0),
    ];
    const lines = [
      head,
      // Totals first, matching the layout on screen and in the sheet.
      line(cb.label, cb.totals),
      ...cb.rows.map((r) => line(r.college, r)),
    ].map((cells) => cells.map(esc).join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `college_wise_${cb.label.replace(/\W+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const title =
    view === 'agent' ? 'My Performance' : view === 'team' ? 'Team Performance' : 'Performance Reports';

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 py-2">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <BarChart3 className="h-5 w-5 text-primary" /> {title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {view === 'agent'
              ? 'Your activity and how it compares with your targets.'
              : view === 'team'
              ? 'Your agents’ activity, individually and as a team.'
              : 'Every agent’s activity, individually and rolled up by team.'}
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!data || rows.length === 0}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/20 p-3">
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-0.5">
          {(['DATEWISE', 'WEEKLY', 'OVERALL'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors',
                range === r ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}
            >
              {r === 'DATEWISE' ? 'Datewise' : r === 'WEEKLY' ? 'Weekly' : 'Overall'}
            </button>
          ))}
        </div>

        {range === 'DATEWISE' && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={SELECT} aria-label="From date" />
            <span className="text-xs text-muted-foreground">to</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={SELECT} aria-label="To date" />
          </>
        )}

        {view === 'manager' && (
          <MultiSelectFilter
            placeholder="All Team Leaders"
            options={(data?.choices.tls ?? []).map((t) => ({ value: t.id, label: t.name }))}
            selected={tlIds}
            onChange={setTlIds}
            triggerClassName="h-9 w-full sm:w-auto sm:min-w-[180px] sm:max-w-[260px]"
          />
        )}

        {view !== 'agent' && (
          <MultiSelectFilter
            placeholder="All Agents"
            options={agentOptions}
            selected={agentIds}
            onChange={setAgentIds}
            triggerClassName="h-9 w-full sm:w-auto sm:min-w-[180px] sm:max-w-[260px]"
          />
        )}

        <span className="ml-auto text-xs text-muted-foreground">
          {data?.label}{isFetching && ' · updating…'}
        </span>
      </div>

      {isLoading || !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* ── Team roll-up: TL and manager only ─────────────────────── */}
          {view !== 'agent' && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">Team totals <span className="font-normal text-muted-foreground">— all your agents, ignoring the agent filter</span></h2>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { label: 'Total Agents', value: data.summary.totalAgents, icon: true },
                  { label: 'Dialed Calls', value: data.summary.dialedCalls },
                  { label: 'Connected', value: data.summary.connectedCalls },
                  { label: 'Not Connected', value: data.summary.notConnectedCalls },
                  { label: 'Applications', value: data.summary.applications },
                  { label: 'Admissions', value: data.summary.admissions },
                ].map((c) => (
                  <div key={c.label} className="rounded-xl border border-border/60 bg-card p-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      {c.icon && <Users className="h-3 w-3" />}{c.label}
                    </div>
                    <div className="mt-1 text-xl font-bold tabular-nums">{c.value.toLocaleString('en-IN')}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Per-agent detail ───────────────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">{view === 'agent' ? 'My activity' : 'Agent detail'}</h2>
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full min-w-[1100px] text-xs">
                <thead className="bg-muted/60">
                  <tr>
                    {['Agent ID', 'Agent Name', 'Agent TL', 'Agent Manager', 'Joining Date', 'Zone', 'Language',
                      'Dialed', 'Connected', 'Not Connected', 'Application', 'Admission', 'Avg Talktime'].map((h, i) => (
                      <th key={h} className={cn('px-3 py-2.5 font-semibold whitespace-nowrap text-muted-foreground', i > 6 ? 'text-center' : 'text-left')}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={13} className="px-4 py-10 text-center text-muted-foreground">No agents match these filters.</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.id} className="border-t border-border/50 hover:bg-muted/30">
                      <td className="px-3 py-2.5 font-mono text-[10px] text-muted-foreground whitespace-nowrap">{r.employeeCode ?? '—'}</td>
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap">{r.name}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{r.tl ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{r.manager ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center whitespace-nowrap text-muted-foreground">
                        {r.joiningDate
                          ? new Date(`${r.joiningDate}T00:00:00Z`).toLocaleDateString('en-IN', {
                              day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
                            })
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{r.zone ?? '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">{r.language ?? '—'}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums font-medium">{r.dialedCalls}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums text-emerald-600 dark:text-emerald-400">{r.connectedCalls}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums text-red-500">{r.notConnectedCalls}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums">{r.applications}</td>
                      <td className="px-3 py-2.5 text-center tabular-nums">{r.admissions}</td>
                      <td className="px-3 py-2.5 text-center text-muted-foreground/60">
                        {r.avgTalktimeMin === null ? 'no data' : r.avgTalktimeMin}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              <Info className="mr-1 inline h-3 w-3" />
              Average Talktime needs the dialer’s call records, which are not yet integrated.
              Applications and Admissions are approved receipts, counted by date paid.
            </p>
          </section>

          {/* ── Feedback summary ───────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                Feedback summary{' '}
                <span className="font-normal text-muted-foreground">
                  — every lead worked in this window, counted once under its latest feedback
                </span>
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={exportFeedbackCsv}
                disabled={data.feedbackBreakdown.rows.length === 0}
              >
                <Download className="mr-2 h-3.5 w-3.5" /> Download
              </Button>
            </div>

            <div className="overflow-hidden rounded-xl border border-border/60">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/60 bg-amber-500/15">
                    <th className="px-4 py-2.5 text-left font-bold" colSpan={2}>
                      <GraduationCap className="mr-1.5 inline h-4 w-4 align-text-bottom" />
                      University/Institution Count
                    </th>
                    <th className="px-4 py-2.5 text-right font-bold tabular-nums">
                      {data.feedbackBreakdown.universities.toLocaleString('en-IN')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.feedbackBreakdown.rows.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-4 py-10 text-center text-muted-foreground">
                        No follow-ups were logged in this window.
                      </td>
                    </tr>
                  ) : (
                    data.feedbackBreakdown.rows.map((r) => {
                      const share = data.feedbackBreakdown.total > 0
                        ? (r.leads / data.feedbackBreakdown.total) * 100
                        : 0;
                      return (
                        <tr
                          key={r.feedback}
                          className={cn('border-b border-border/40 last:border-b-0', categoryTone(r.category))}
                          title={r.category ? `${r.category} category` : 'No category set'}
                        >
                          <td className="whitespace-nowrap px-4 py-2">{r.feedback}</td>
                          {/*
                            One hue, not one per category: this column's job is
                            magnitude, and a colour per row would be a 22-way
                            rainbow encoding nothing. The category is already
                            carried by the row tint. Square at the baseline,
                            4px rounded at the data end.
                          */}
                          <td className="w-full px-4 py-2">
                            <div className="flex items-center gap-2.5">
                              <div className="h-2 min-w-[3rem] flex-1 overflow-hidden rounded-sm bg-primary/10">
                                <div
                                  className="h-full rounded-r-[4px] bg-primary/70"
                                  style={{ width: `${share}%` }}
                                />
                              </div>
                              <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                                {/* A row that exists is never "0%" — that reads as nothing happened. */}
                                {share > 0 && share < 1 ? '<1%' : `${Math.round(share)}%`}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.leads.toLocaleString('en-IN')}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {data.feedbackBreakdown.rows.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-amber-500/15">
                      <td className="px-4 py-2.5 font-bold" colSpan={2}>Total</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                        {data.feedbackBreakdown.total.toLocaleString('en-IN')}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              <Info className="mr-1 inline h-3 w-3" />
              Every follow-up in this window, whoever logged it — including agents who have since
              left, so past periods do not shrink as people move on. Narrow it with the filters
              above. A lead appears once, under its latest feedback, so the Total is leads worked,
              not follow-ups logged. Outcomes nobody used do not appear. Row colour is the
              feedback&rsquo;s category.
              {' '}It will not always match Dialed Calls above: that strip counts active agents only,
              and counts a lead once for each agent who worked it.
            </p>
          </section>

          {/* ── College-wise ───────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                University / College wise{' '}
                <span className="font-normal text-muted-foreground">
                  — the same leads, split by college instead of by outcome
                </span>
              </h2>
              <div className="flex items-center gap-2">
                <MultiSelectFilter
                  placeholder="Outcome columns"
                  options={available.map((o) => ({ value: o, label: o }))}
                  selected={shownOutcomes}
                  onChange={setOutcomeCols}
                  // Safe here: the list is one entry per feedback option that
                  // occurred, so a couple of dozen at most, and it only adds
                  // columns to a table rather than going into a query string.
                  selectAll
                  triggerClassName="h-8 w-full sm:w-auto sm:min-w-[170px] sm:max-w-[260px]"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={exportCollegeCsv}
                  disabled={data.collegeBreakdown.rows.length === 0}
                >
                  <Download className="mr-2 h-3.5 w-3.5" /> Download
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full min-w-[820px] text-xs">
                <thead>
                  {/* Totals sit above the rows, as they do in the sheet this replaces —
                      the headline is read first and the detail is the evidence for it. */}
                  <tr className="bg-amber-500/15 font-bold">
                    <th className="px-3 py-2.5 text-left whitespace-nowrap">{data.collegeBreakdown.label}</th>
                    <th className="px-3 py-2.5 text-center tabular-nums">{data.collegeBreakdown.totals.dialed.toLocaleString('en-IN')}</th>
                    <th className="px-3 py-2.5 text-center tabular-nums">{data.collegeBreakdown.totals.connected.toLocaleString('en-IN')}</th>
                    <th className="px-3 py-2.5 text-center tabular-nums">
                      {data.collegeBreakdown.totals.connectedPct === null ? '—' : `${data.collegeBreakdown.totals.connectedPct}%`}
                    </th>
                    <th className="px-3 py-2.5 text-center tabular-nums">{data.collegeBreakdown.totals.notConnected.toLocaleString('en-IN')}</th>
                    {showOther && (
                      <th className="px-3 py-2.5 text-center tabular-nums">{data.collegeBreakdown.totals.other.toLocaleString('en-IN')}</th>
                    )}
                    {shownOutcomes.map((o) => (
                      <th key={o} className="px-3 py-2.5 text-center tabular-nums">
                        {(data.collegeBreakdown.totals.outcomes[o] ?? 0).toLocaleString('en-IN')}
                      </th>
                    ))}
                  </tr>
                  <tr className="border-y border-border/60 bg-emerald-500/10 text-muted-foreground">
                    <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">
                      <Building2 className="mr-1.5 inline h-3.5 w-3.5 align-text-bottom" />University Name
                    </th>
                    {['Dialed', 'Connected', 'Connected %', 'Not Connected', ...(showOther ? ['Other'] : []), ...shownOutcomes].map((h) => (
                      <th key={h} className="px-3 py-2 text-center font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.collegeBreakdown.rows.length === 0 ? (
                    <tr>
                      <td colSpan={5 + (showOther ? 1 : 0) + shownOutcomes.length} className="px-4 py-10 text-center text-muted-foreground">
                        No follow-ups were logged in this window.
                      </td>
                    </tr>
                  ) : (
                    data.collegeBreakdown.rows.map((r) => (
                      <tr key={r.college} className="border-b border-border/40 last:border-b-0 hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium">{r.college}</td>
                        <td className="px-3 py-2 text-center tabular-nums">{r.dialed.toLocaleString('en-IN')}</td>
                        <td className="px-3 py-2 text-center tabular-nums text-emerald-600 dark:text-emerald-400">{r.connected.toLocaleString('en-IN')}</td>
                        {/* Deliberately not pctTone: that scale means "share of
                            target achieved", where under 50 is a miss. A 40%
                            connect rate is an ordinary day, and painting most of
                            the report red would say something untrue. */}
                        <td className="px-3 py-2 text-center font-medium tabular-nums">
                          {r.connectedPct === null ? '—' : `${r.connectedPct}%`}
                        </td>
                        <td className="px-3 py-2 text-center tabular-nums text-red-500">{r.notConnected.toLocaleString('en-IN')}</td>
                        {showOther && (
                          <td className="px-3 py-2 text-center tabular-nums text-muted-foreground" title="Latest feedback is in neither the Connected nor the Not Connected category">
                            {r.other}
                          </td>
                        )}
                        {shownOutcomes.map((o) => (
                          <td key={o} className={cn('px-3 py-2 text-center tabular-nums', !r.outcomes[o] && 'text-muted-foreground/40')}>
                            {r.outcomes[o] ?? 0}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              <Info className="mr-1 inline h-3 w-3" />
              The same leads as the summary above, counted the same way, so Dialed totals to the
              same number. Connected and Not Connected add back to Dialed on every row; an{' '}
              <strong>Other</strong> column appears if a feedback category beyond those two is in
              use, so a row can never quietly fail to add up. Pick which outcome columns to show
              with the selector — every outcome is already loaded, so changing them is instant.
            </p>
          </section>

          {/* ── Benchmarking: single agent only ────────────────────────── */}
          {data.benchmarking.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold">
                Benchmarking <span className="font-normal text-muted-foreground">— against the {data.benchmarking[0].period.toLowerCase()} targets</span>
              </h2>
              <div className="overflow-x-auto rounded-xl border border-border/60">
                <table className="w-full min-w-[520px] text-sm">
                  <thead className="bg-muted/60">
                    <tr>
                      <th className="px-4 py-2.5 text-left font-semibold">KPI</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Target</th>
                      <th className="px-4 py-2.5 text-center font-semibold">Achieved</th>
                      <th className="px-4 py-2.5 text-center font-semibold">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.benchmarking.map((b) => (
                      <tr key={b.kpi} className="border-t border-border/50">
                        <td className="px-4 py-2.5">{b.kpi}{b.unit && <span className="ml-1 text-[11px] text-muted-foreground">({b.unit})</span>}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{b.target}</td>
                        <td className="px-4 py-2.5 text-center tabular-nums">{b.actual === null ? <span className="text-muted-foreground/60">no data</span> : b.actual}</td>
                        <td className={cn('px-4 py-2.5 text-center font-medium tabular-nums', pctTone(b.pct))}>
                          {b.pct === null ? '—' : `${b.pct}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Targets come from KPI Targets and apply to every agent. Leave days are not deducted — a Daily
                target is judged against the selected day.
              </p>
            </section>
          )}

          {view !== 'agent' && data.benchmarking.length === 0 && rows.length !== 1 && (
            <p className="text-xs text-muted-foreground">
              Pick a single agent above to see their benchmarking against targets.
            </p>
          )}
        </>
      )}
    </div>
  );
}
