'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import {
  AudioLines, Loader2, Search, AlertTriangle, Eye, Gauge, ChevronDown, ChevronRight,
  ShieldAlert, PhoneOff, UserRound, Flag, ListChecks, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn, formatDateTime } from '@/lib/utils';
import { groupMetrics, toPercent, BAND_STYLES, gradeBand } from '@/lib/call-analysis-criteria';
import { ScoreRing, GradeChip, CriterionBar } from '@/components/call-analysis/score-views';

interface AnalysisRow {
  id: string;
  score: number | null;
  maxScore: number | null;
  qaGrade: string | null;
  qaStatus: string | null;
  intent: string | null;
  fatalError: boolean;
  needsReview: boolean;
  redFlags: unknown;
  summary: string | null;
  metrics: unknown;
  scoredAt: string | null;
  receivedAt: string;
  callLog: {
    id: string;
    uniqueId: string | null;
    phoneNumber: string | null;
    startedAt: string | null;
    netTalkSeconds: number;
    agent: { id: string; name: string } | null;
    lead: { id: string; name: string; college: string | null } | null;
    hasRecording: boolean;
  };
}

interface AnalysisResponse {
  rows: AnalysisRow[];
  total: number;
  totalPages: number;
  stats: {
    graded: number;
    flagged: number;
    fatal: number;
    avgScore: number | null;
    byGrade: { grade: string; count: number }[];
  };
  intents: string[];
  /** Set when the list is scoped to one lead, so the page can name it. */
  lead: { id: string; name: string } | null;
  /** 'agent' when the session only ever sees its own calls. */
  view: 'agent' | 'manager';
}

interface AgentOption { id: string; name: string }

function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function readFlags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

// ─── Expanded detail ──────────────────────────────────────────────────────────

function DetailPanel({ row }: { row: AnalysisRow }) {
  const groups = groupMetrics(row.metrics);
  const flags = readFlags(row.redFlags);

  return (
    <div className="grid gap-5 border-t bg-muted/30 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      {/* Left: what happened on the call */}
      <div className="space-y-4">
        <div>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <ListChecks className="h-3.5 w-3.5" /> Analyser summary
          </h4>
          <p className="text-sm leading-relaxed text-foreground/90">
            {row.summary?.trim() || <span className="text-muted-foreground">No summary was sent for this call.</span>}
          </p>
        </div>

        {flags.length > 0 && (
          <div>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
              <Flag className="h-3.5 w-3.5" /> Red flags ({flags.length})
            </h4>
            <ul className="space-y-1">
              {flags.map((f, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-red-300/50 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-400"
                >
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <h4 className="mb-1.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            <AudioLines className="h-3.5 w-3.5" /> Recording
          </h4>
          {row.callLog.hasRecording ? (
            <audio
              controls
              // Loaded only once the row is open — a list of 25 would otherwise
              // pull 25 recordings off the dialer on every page view.
              preload="none"
              className="h-9 w-full"
              src={`/api/call-analysis/${row.callLog.id}/recording`}
            >
              Your browser cannot play this recording.
            </audio>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <PhoneOff className="h-3.5 w-3.5" /> The dialer sent no recording for this call.
            </p>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-xs">
          <div>
            <dt className="text-muted-foreground">Dialer call ID</dt>
            <dd className="font-mono text-[11px] text-foreground/90">{row.callLog.uniqueId ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">QA status</dt>
            <dd className="capitalize text-foreground/90">{row.qaStatus ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Scored at</dt>
            <dd className="text-foreground/90">{row.scoredAt ? formatDateTime(row.scoredAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Received at</dt>
            <dd className="text-foreground/90">{formatDateTime(row.receivedAt)}</dd>
          </div>
        </dl>
      </div>

      {/* Right: the scorecard */}
      <div className="space-y-4">
        {groups.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            The analyser sent an overall score but no per-criterion breakdown for this call.
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.title}>
              {/* Hint sits with the title, not flung to the far right of a
                  two-column grid where it reads as unrelated. */}
              <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                <h4 className="text-xs font-bold uppercase tracking-wide text-foreground/70">{g.title}</h4>
                <span className="text-[11px] text-muted-foreground">{g.hint}</span>
              </div>
              <div className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                {g.items.map((c) => (
                  <CriterionBar key={c.key} label={c.label} hint={c.hint} value={c.value} />
                ))}
              </div>
            </div>
          ))
        )}
        {groups.some((g) => g.items.some((c) => c.value === null)) && (
          <p className="border-t pt-2 text-[11px] text-muted-foreground">
            <span className="font-semibold">N/A</span> means the criterion did not apply to this call —
            it is left out of the overall score rather than counted as zero.
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CallAnalysisPage() {
  const router = useRouter();
  // Set when arriving from a score circle in All Leads or the lead drawer.
  // Held in the URL rather than in state so the link is shareable and Back
  // behaves the way the reader expects.
  const leadId = useSearchParams().get('leadId');

  /**
   * An agent only ever sees their own calls. Read from the session so the
   * layout is right on first paint — the API decides this independently and
   * returns `view`, which is the authority; this is only a hint for what to
   * render, and showing a control the server ignores would be the worst of
   * both.
   */
  const { data: session } = useSession();
  const isAgentView = session?.user?.role === 'COUNSELLING_AGENT';

  const [grade, setGrade] = useState<string | null>(null);
  const [intent, setIntent] = useState('');
  const [agentId, setAgentId] = useState('');
  const [search, setSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);

  const { data: agents = [] } = useQuery<AgentOption[]>({
    queryKey: ['call-analysis-agents'],
    enabled: !isAgentView,
    queryFn: () =>
      fetch('/api/users?role=COUNSELLING_AGENT').then(async (r) => {
        const d = await r.json();
        return Array.isArray(d) ? d : [];
      }),
  });

  const { data, isLoading, isFetching } = useQuery<AnalysisResponse>({
    queryKey: ['call-analysis', leadId, grade, intent, agentId, search, flaggedOnly, from, to, page],
    queryFn: async () => {
      const p = new URLSearchParams({ page: String(page), limit: '25' });
      if (leadId) p.set('leadId', leadId);
      if (grade) p.set('grade', grade);
      if (intent) p.set('intent', intent);
      if (agentId) p.set('agentId', agentId);
      if (search.trim()) p.set('search', search.trim());
      if (flaggedOnly) p.set('view', 'flagged');
      if (from) p.set('from', from);
      if (to) p.set('to', to);
      const r = await fetch(`/api/call-analysis?${p}`);
      if (!r.ok) throw new Error(`Failed to load call analysis (HTTP ${r.status})`);
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const rows = data?.rows ?? [];
  const stats = data?.stats ?? { graded: 0, flagged: 0, fatal: 0, avgScore: null, byGrade: [] };
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;
  const gradeTotal = stats.byGrade.reduce((s, g) => s + g.count, 0);
  const filtered = Boolean(grade || intent || agentId || search.trim() || flaggedOnly || from || to);

  function resetFilters() {
    setGrade(null); setIntent(''); setAgentId(''); setSearch('');
    setFlaggedOnly(false); setFrom(''); setTo(''); setPage(1);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold sm:text-2xl">
          <Gauge className="h-5 w-5 text-primary sm:h-6 sm:w-6" /> Call Analysis
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {isAgentView
            ? 'Quality scores for your own calls, matched to the recording they were scored from. Open a row for the breakdown, the red flags and the audio.'
            : 'Quality scores returned by the call analyser, matched to the recording they were scored from. Open a row for the breakdown, the red flags and the audio.'}
        </p>
      </div>

      {/* Scoped to one lead, arrived at from a score circle. Shown as a
          dismissable banner rather than another filter chip: it changes what
          the whole page is about, including the summary cards. */}
      {leadId && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
          <p className="flex items-center gap-2 text-sm">
            <UserRound className="h-4 w-4 text-primary" />
            <span>
              Showing scored calls for{' '}
              <span className="font-semibold">{data?.lead?.name ?? 'this lead'}</span>
              <span className="ml-1.5 tabular-nums text-muted-foreground">{leadId}</span>
            </span>
          </p>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => router.push('/dashboard/super-admin/call-analysis')}
          >
            <X className="h-3.5 w-3.5" /> Show all calls
          </Button>
        </div>
      )}

      {/* Summary — totals for whatever the page is scoped to: all scored
          calls, or one lead's when a lead is named. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Calls Scored', value: String(stats.graded), Icon: ListChecks, color: 'text-foreground' },
          {
            label: 'Average Score',
            value: stats.avgScore === null ? '—' : stats.avgScore.toFixed(1),
            Icon: Gauge,
            color: stats.avgScore === null
              ? 'text-muted-foreground'
              : BAND_STYLES[gradeBand(null, stats.avgScore)].text,
          },
          { label: 'Needs Attention', value: String(stats.flagged), Icon: Eye, color: 'text-amber-600 dark:text-amber-400' },
          { label: 'Fatal Errors', value: String(stats.fatal), Icon: ShieldAlert, color: 'text-red-600 dark:text-red-400' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl border border-border/60 bg-card p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
              <c.Icon className={cn('h-4 w-4', c.color)} />
            </div>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', c.color)}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Grade mix — the shape of the whole set in one line, and the grade filter */}
      {gradeTotal > 0 && (
        <div className="rounded-xl border border-border/60 bg-card p-3 sm:p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Grade mix</span>
            {grade && (
              <button onClick={() => { setGrade(null); setPage(1); }} className="text-[11px] text-primary hover:underline">
                Clear grade filter
              </button>
            )}
          </div>
          <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full">
            {stats.byGrade.map((g) => (
              <div
                key={g.grade}
                title={`${g.grade}: ${g.count}`}
                className={cn('h-full first:rounded-l-full last:rounded-r-full', BAND_STYLES[gradeBand(g.grade, null)].bar)}
                style={{ width: `${(g.count / gradeTotal) * 100}%` }}
              />
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {stats.byGrade.map((g) => (
              <button
                key={g.grade}
                onClick={() => { setGrade(grade === g.grade ? null : g.grade); setPage(1); }}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  grade === g.grade ? 'border-primary/60 bg-primary/10' : 'border-border/60 hover:bg-muted/50',
                )}
              >
                <span className={cn('h-2 w-2 rounded-full', BAND_STYLES[gradeBand(g.grade, null)].bar)} />
                {g.grade}
                <span className="font-bold tabular-nums">{g.count}</span>
                <span className="text-muted-foreground">
                  {Math.round((g.count / gradeTotal) * 100)}%
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => { setFlaggedOnly((v) => !v); setPage(1); }}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors',
            flaggedOnly
              ? 'border-amber-400/60 bg-amber-500/15 text-amber-700 dark:text-amber-400'
              : 'border-border/60 text-muted-foreground hover:bg-muted/50',
          )}
        >
          <AlertTriangle className="h-3.5 w-3.5" /> Needs attention
        </button>

        <select
          value={intent}
          onChange={(e) => { setIntent(e.target.value); setPage(1); }}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          aria-label="Intent"
        >
          <option value="">All intents</option>
          {(data?.intents ?? []).map((i) => <option key={i} value={i}>{i}</option>)}
        </select>

        {/* No agent filter for an agent — they are pinned to their own calls
            server-side, so the control would have exactly one option. */}
        {!isAgentView && (
          <select
            value={agentId}
            onChange={(e) => { setAgentId(e.target.value); setPage(1); }}
            className="h-9 max-w-[180px] rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Agent"
          >
            <option value="">All agents</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}

        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search summary, lead name, LID, phone, dialer call ID…"
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>

        {/* Scored-on range — when the analyser returned its verdict */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Input
            type="date" aria-label="Scored from" className="h-9 w-[150px]"
            value={from} max={to || undefined}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date" aria-label="Scored to" className="h-9 w-[150px]"
            value={to} min={from || undefined}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
          />
        </div>

        {filtered && (
          <Button variant="ghost" size="sm" className="h-9 px-2 text-xs" onClick={resetFilters}>
            Clear all
          </Button>
        )}
        {isFetching && !isLoading && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Updating…
          </span>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed py-16 text-center">
          <AudioLines className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-medium">No scored calls{filtered ? ' for these filters' : ' yet'}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {filtered
              ? 'Try widening the date range or clearing the filters.'
              : 'Scores appear here as the analyser posts them to the Call Analysis webhook.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border">
          <table className="w-full text-sm">
            {/* Fixed widths on everything except Lead, which takes the slack.
                Without them each column is sized by its widest cell, so the
                rhythm shifts from page to page as the data changes. */}
            <colgroup>
              <col className="w-9" />
              <col className="w-[175px]" />
              <col className="w-[185px]" />
              <col className="w-[260px]" />
              {!isAgentView && <col className="w-[150px]" />}
              <col className="w-[160px]" />
              <col />
            </colgroup>
            <thead className="bg-muted/50 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-2.5 pl-3 pr-1" />
                <th className="px-3 py-2.5">Score</th>
                <th className="px-3 py-2.5">Call</th>
                <th className="px-3 py-2.5">Lead</th>
                {!isAgentView && <th className="px-3 py-2.5">Agent</th>}
                <th className="px-3 py-2.5">Intent</th>
                <th className="px-3 py-2.5">Flags</th>
              </tr>
            </thead>
            {/* One <tbody> per call, so the expanded panel is a sibling row of
                the summary row rather than a nested table. */}
            {rows.map((r) => {
                const pct = toPercent(r.score, r.maxScore);
                const isOpen = open === r.id;
                const flags = readFlags(r.redFlags);
                return (
                  <tbody key={r.id} className="border-t align-middle">
                    <tr
                      onClick={() => setOpen(isOpen ? null : r.id)}
                      className={cn(
                        'cursor-pointer transition-colors hover:bg-muted/40',
                        isOpen && 'bg-muted/40',
                        // A fatal error is the one state worth tinting the
                        // whole row for — it is a compliance failure, not a
                        // low score.
                        r.fatalError && 'bg-red-500/[0.06] hover:bg-red-500/10',
                      )}
                    >
                      <td className="py-3 pl-3 pr-1 text-muted-foreground">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <ScoreRing pct={pct} label={r.qaGrade} />
                          <div className="min-w-0 space-y-1">
                            <GradeChip grade={r.qaGrade} pct={pct} />
                            <p className="text-[11px] tabular-nums text-muted-foreground">
                              {r.score === null ? 'not scored' : `${r.score} / ${r.maxScore ?? 100}`}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="whitespace-nowrap text-xs font-medium">
                          {r.callLog.startedAt ? formatDateTime(r.callLog.startedAt) : '—'}
                        </p>
                        <p className="mt-1 flex items-center gap-2 whitespace-nowrap text-[11px] text-muted-foreground">
                          <span className="tabular-nums">{duration(r.callLog.netTalkSeconds)} talk</span>
                          {r.callLog.hasRecording
                            ? <span className="inline-flex items-center gap-1 text-foreground/70"><AudioLines className="h-3 w-3" /> audio</span>
                            : <span className="inline-flex items-center gap-1"><PhoneOff className="h-3 w-3" /> no audio</span>}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        {r.callLog.lead ? (
                          <>
                            <p className="truncate text-xs font-medium">{r.callLog.lead.name}</p>
                            <p className="mt-1 truncate text-[11px] text-muted-foreground">
                              <span className="tabular-nums">{r.callLog.lead.id}</span>
                              {r.callLog.lead.college ? ` · ${r.callLog.lead.college}` : ''}
                            </p>
                          </>
                        ) : (
                          <>
                            {/* Roughly half of all calls match no lead. Showing
                                the number keeps the row identifiable. */}
                            <p className="text-xs italic text-muted-foreground">No lead matched</p>
                            <p className="mt-1 tabular-nums text-[11px] text-muted-foreground">{r.callLog.phoneNumber ?? '—'}</p>
                          </>
                        )}
                      </td>
                      {!isAgentView && (
                        <td className="px-3 py-3">
                          <span className="flex items-center gap-1.5 text-xs">
                            <UserRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{r.callLog.agent?.name ?? '—'}</span>
                          </span>
                        </td>
                      )}
                      <td className="px-3 py-3">
                        {r.intent
                          ? <span className="inline-flex max-w-full truncate rounded-full border border-border/60 bg-muted/60 px-2 py-0.5 text-[10px] font-medium">{r.intent}</span>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-nowrap items-center gap-1">
                          {r.fatalError && (
                            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-red-300/50 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-400">
                              <ShieldAlert className="h-3 w-3 shrink-0" /> Fatal
                            </span>
                          )}
                          {r.needsReview && (
                            <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-300/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
                              <Eye className="h-3 w-3 shrink-0" /> Review
                            </span>
                          )}
                          {flags.length > 0 && (
                            <span
                              title={flags.join(' · ')}
                              className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-border/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                            >
                              <Flag className="h-3 w-3 shrink-0" /> {flags.length}
                            </span>
                          )}
                          {!r.fatalError && !r.needsReview && flags.length === 0 && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td colSpan={isAgentView ? 6 : 7} className="p-0">
                          <DetailPanel row={r} />
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
            })}
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Page {page} of {totalPages} · {total} scored call{total === 1 ? '' : 's'}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => { setOpen(null); setPage((p) => Math.max(1, p - 1)); }}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => { setOpen(null); setPage((p) => p + 1); }}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
