'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { BarChart3, Loader2, Download, Users, Info } from 'lucide-react';
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
  benchmarking: { kpi: string; unit: string; period: string; target: number; actual: number | null; pct: number | null }[];
  choices: { agents: { id: string; name: string; employeeCode: string | null }[]; tls: { id: string; name: string }[] };
}

const SELECT =
  'h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

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
