'use client';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { Target, Save, Loader2, Info, Plus, Pencil, Trash2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SourceMeta {
  key: string;
  label: string;
  help: string;
  needs: ('feedback' | 'leadStages' | 'receiptType')[];
  snapshot?: boolean;
  measurable: boolean;
}
interface PeriodMeta { key: string; label: string }

interface Definition {
  id: string;
  name: string;
  unit: string;
  source: string;
  feedbackOptionIds: string[];
  feedbackCategoryIds: string[];
  leadStages: string[];
  receiptType: string | null;
  isActive: boolean;
  sortOrder: number;
  targets: Record<string, number>;
  /** What hitting the target is worth, per period. Absent = measured, not scored. */
  points: Record<string, number>;
}

interface KpiResponse {
  definitions: Definition[];
  sources: SourceMeta[];
  periods: PeriodMeta[];
  ranges: Record<string, { label: string }>;
  period: string;
  achievement: {
    user: { id: string; name: string; employeeCode?: string | null };
    actuals: Record<string, number | null>;
    scores: Record<string, number | null>;
    totalScore: number;
  }[];
  /** The score a full house is worth this period — every total's denominator. */
  maxScore: number;
  choices: {
    categories: { id: string; name: string }[];
    options: { id: string; label: string; categoryId: string | null }[];
    leadStages: string[];
  };
  canEdit: boolean;
  lastSet: { at: string; by: string } | null;
}

const BLANK = {
  id: '', name: '', unit: '', source: 'FEEDBACK_COUNT',
  feedbackOptionIds: [] as string[], feedbackCategoryIds: [] as string[],
  leadStages: [] as string[], receiptType: null as string | null,
  isActive: true, sortOrder: 0,
};

function toneFor(actual: number, target: number | null) {
  if (target === null || target <= 0) return 'text-muted-foreground';
  const pct = (actual / target) * 100;
  if (pct >= 100) return 'text-emerald-600 dark:text-emerald-400';
  if (pct >= 50) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-500';
}

const SELECT =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Compact multi-select rendered as toggle chips — clearer than a native multiple. */
function ChipPicker({
  items, selected, onToggle, empty,
}: { items: { id: string; label: string }[]; selected: string[]; onToggle: (id: string) => void; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-border/60 p-2">
      {items.map((i) => {
        const on = selected.includes(i.id);
        return (
          <button
            key={i.id}
            type="button"
            onClick={() => onToggle(i.id)}
            className={cn(
              'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
              on ? 'border-primary bg-primary text-primary-foreground' : 'border-border hover:bg-muted',
            )}
          >
            {i.label}
          </button>
        );
      })}
    </div>
  );
}

export default function KpiPage() {
  const { data: session } = useSession();
  const qc = useQueryClient();
  const { toast } = useToast();

  const [period, setPeriod] = useState('DAILY');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState<typeof BLANK | null>(null);

  const { data, isLoading } = useQuery<KpiResponse>({
    queryKey: ['kpi', period],
    queryFn: () => fetch(`/api/kpi/targets?period=${period}`).then((r) => r.json()),
    enabled: !!session?.user?.id,
  });

  // Guarded on `dirty` so switching the achievement period, which refetches,
  // cannot discard unsaved target edits.
  useEffect(() => {
    if (!data?.definitions || dirty) return;
    const next: Record<string, string> = {};
    for (const d of data.definitions) {
      for (const p of data.periods) {
        const v = d.targets[p.key];
        next[`${d.id}:${p.key}`] = v === undefined ? '' : String(v);
        const pts = d.points?.[p.key];
        next[`${d.id}:${p.key}:pts`] = pts === undefined ? '' : String(pts);
      }
    }
    setDraft(next);
  }, [data, dirty]);

  const saveTargets = useMutation({
    mutationFn: async () => {
      // The draft holds both a target and a points value per cell; only the
      // target keys are iterated so each KPI/period is sent exactly once.
      const targets = Object.entries(draft)
        .filter(([k]) => !k.endsWith(':pts'))
        .map(([k, v]) => {
          const [definitionId, p] = k.split(':');
          const pts = draft[`${k}:pts`] ?? '';
          return {
            definitionId,
            period: p,
            target: v.trim() === '' ? null : Number(v),
            points: pts.trim() === '' ? null : Number(pts),
          };
        });
      const r = await fetch('/api/kpi/targets', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targets }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Could not save targets');
    },
    onSuccess: () => {
      toast({ title: 'Targets saved', description: 'Applied to every agent.' });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Save failed', description: e.message }),
  });

  const saveDefinition = useMutation({
    mutationFn: async (d: typeof BLANK) => {
      const editingExisting = !!d.id;
      const r = await fetch('/api/kpi/definitions', {
        method: editingExisting ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editingExisting ? d : { ...d, id: undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Could not save this KPI');
    },
    onSuccess: () => {
      toast({ title: 'KPI saved' });
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['kpi'] });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Save failed', description: e.message }),
  });

  const deleteDefinition = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/kpi/definitions?id=${id}`, { method: 'DELETE' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Could not delete');
    },
    onSuccess: () => { toast({ title: 'KPI deleted' }); qc.invalidateQueries({ queryKey: ['kpi'] }); },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Delete failed', description: e.message }),
  });

  const canEdit = data?.canEdit ?? false;
  const defs = data?.definitions ?? [];
  const periods = data?.periods ?? [];
  const sourceOf = (key: string) => data?.sources.find((s) => s.key === key);

  const invalid = useMemo(
    () =>
      Object.entries(draft).some(([k, v]) => {
        if (v.trim() === '') return false;
        if (!/^\d+$/.test(v.trim())) return true;
        return Number(v) > (k.endsWith(':pts') ? 10_000 : 1_000_000);
      }),
    [draft],
  );

  const targetFor = (id: string) => defs.find((d) => d.id === id)?.targets[period] ?? null;
  const pointsFor = (id: string) => defs.find((d) => d.id === id)?.points?.[period] ?? null;

  // Only these roles get the export. An agent sees their own row on this page
  // and has no reason to pull the whole team's scoreboard out of the CRM.
  const canExport = ['SUPER_ADMIN', 'REPORTS', 'COUNSELLING_TL'].includes(session?.user?.role ?? '');

  // The points weighting is management configuration, so agents do not see it.
  // The line drawn here is config versus outcome: an agent still sees their own
  // Score below, which is the whole point of scoring them — they just do not see
  // how each target was weighted to produce it.
  const showPoints = session?.user?.role !== 'COUNSELLING_AGENT';

  /**
   * The scoreboard as CSV — every agent, every KPI, and how the score was
   * reached rather than just the total. A manager questioning a number needs the
   * actual, the target and the points to see where it came from, so each KPI
   * contributes three columns instead of one.
   *
   * Built client-side from what is already on screen, so the file always matches
   * the period shown and cannot disagree with the table above it.
   */
  function exportScores() {
    if (!data) return;
    const head = [
      'Agent', 'Employee Code', 'Period', 'Range',
      ...defs.flatMap((d) => [
        `${d.name} — achieved`,
        `${d.name} — target`,
        `${d.name} — points earned`,
      ]),
      'Total Score', 'Max Score', 'Score %',
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const periodLabel = periods.find((p) => p.key === period)?.label ?? period;
    const rangeLabel = data.ranges[period]?.label ?? '';
    const body = data.achievement.map((row) =>
      [
        row.user.name,
        row.user.employeeCode ?? '',
        periodLabel,
        rangeLabel,
        ...defs.flatMap((d) => [
          row.actuals[d.id] ?? '',
          targetFor(d.id) ?? '',
          row.scores[d.id] ?? '',
        ]),
        row.totalScore,
        data.maxScore,
        data.maxScore > 0 ? `${Math.round((row.totalScore / data.maxScore) * 100)}%` : '',
      ].map(esc).join(','),
    );
    const blob = new Blob([[head.map(esc).join(','), ...body].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kpi_scores_${periodLabel.toLowerCase()}_${(rangeLabel || 'export').replace(/\W+/g, '_')}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** Plain-English summary of what a KPI counts, shown under its name. */
  function describe(d: Definition): string {
    const src = sourceOf(d.source);
    if (!src) return '';
    if (d.source === 'NOT_MEASURED') return 'Target only — no data source yet.';
    if (d.source === 'LEAD_STAGE_LIVE') return `Assigned leads currently at ${d.leadStages.join(' or ') || '(no stage chosen)'} — live count.`;
    if (d.source === 'RECEIPT_COUNT') return `Approved ${(d.receiptType ?? '').toLowerCase()} receipts, by date paid.`;
    if (d.source === 'LEADS_ASSIGNED') return 'Leads assigned to the agent in the period.';
    // The dialer-fed sources have no feedback config to describe, and falling
    // through to the feedback wording below labelled Talktime as "follow-ups
    // logged", which is the wrong data entirely.
    if (d.source === 'CALL_TALKTIME_MINUTES') return 'Minutes talked, from the dialer’s post-call records.';
    if (d.source === 'CALL_COUNT') return 'Calls the dialer reported in the period, answered or not.';
    if (d.source === 'CALL_CONNECTED_COUNT') return 'Calls the dialer marked CONNECTED in the period.';
    const cats = d.feedbackCategoryIds.map((id) => data?.choices.categories.find((c) => c.id === id)?.name).filter(Boolean);
    const opts = d.feedbackOptionIds.map((id) => data?.choices.options.find((o) => o.id === id)?.label).filter(Boolean);
    const bits = [...cats.map((c) => `${c} category`), ...opts];
    const unit = d.source === 'FEEDBACK_LEADS' ? 'Distinct leads with' : 'Follow-ups';
    return bits.length === 0 ? `${unit} any feedback logged in the period.` : `${unit} ${bits.join(', ')}.`;
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-2">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <Target className="h-5 w-5 text-primary" /> KPI Targets
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Define what you measure, set one target for every agent, and see who is hitting it.
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-3">
            {dirty && <span className="text-xs text-amber-600">Unsaved changes</span>}
            <Button variant="outline" onClick={() => setEditing({ ...BLANK, sortOrder: defs.length + 1 })}>
              <Plus className="mr-2 h-4 w-4" /> Add KPI
            </Button>
            <Button onClick={() => saveTargets.mutate()} disabled={!dirty || invalid || saveTargets.isPending}>
              {saveTargets.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Save Targets
            </Button>
          </div>
        )}
      </div>

      {isLoading || !data ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <>
          {/* ── Targets ─────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Targets — applied to all agents</h2>
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">KPI</th>
                    {periods.map((p) => (
                      <th key={p.key} className="px-4 py-3 text-center font-semibold whitespace-nowrap">
                        {p.label}
                        <span className="block text-[10px] font-normal text-muted-foreground">{data.ranges[p.key]?.label}</span>
                      </th>
                    ))}
                    {canEdit && <th className="px-3 py-3 text-right font-semibold">Edit</th>}
                  </tr>
                </thead>
                <tbody>
                  {defs.length === 0 ? (
                    <tr><td colSpan={periods.length + 2} className="px-4 py-10 text-center text-muted-foreground">
                      No KPIs yet. {canEdit ? 'Use “Add KPI” to create one.' : ''}
                    </td></tr>
                  ) : defs.map((d) => {
                    const src = sourceOf(d.source);
                    return (
                      <tr key={d.id} className={cn('border-t border-border/50', !d.isActive && 'opacity-50')}>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium">
                            {d.name}
                            {d.unit && <span className="ml-1 text-[11px] font-normal text-muted-foreground">({d.unit})</span>}
                          </div>
                          <div className="mt-0.5 max-w-[320px] text-[11px] leading-snug text-muted-foreground">{describe(d)}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {src && !src.measurable && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                <Info className="h-3 w-3" /> Not measured
                              </span>
                            )}
                            {src?.snapshot && (
                              <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">Live count</span>
                            )}
                            {!d.isActive && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px]">Inactive</span>}
                          </div>
                        </td>
                        {periods.map((p) => (
                          <td key={p.key} className="px-4 py-3 text-center align-top">
                            <div className="inline-flex flex-col items-center gap-1">
                              <input
                                value={draft[`${d.id}:${p.key}`] ?? ''}
                                onChange={(e) => { setDraft((x) => ({ ...x, [`${d.id}:${p.key}`]: e.target.value.replace(/[^\d]/g, '') })); setDirty(true); }}
                                disabled={!canEdit}
                                inputMode="numeric"
                                placeholder="—"
                                aria-label={`${d.name} ${p.label} target`}
                                className="h-9 w-24 rounded-md border border-input bg-background px-2 text-center text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
                              />
                              {/* Points sit under the target they belong to: a
                                  target is meaningless to score without knowing
                                  what it is worth, and a separate table would put
                                  the two halves of one decision far apart. */}
                              {showPoints && (
                              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                <input
                                  value={draft[`${d.id}:${p.key}:pts`] ?? ''}
                                  onChange={(e) => { setDraft((x) => ({ ...x, [`${d.id}:${p.key}:pts`]: e.target.value.replace(/[^\d]/g, '') })); setDirty(true); }}
                                  disabled={!canEdit || (draft[`${d.id}:${p.key}`] ?? '').trim() === ''}
                                  inputMode="numeric"
                                  placeholder="—"
                                  aria-label={`${d.name} ${p.label} points`}
                                  className="h-6 w-14 rounded border border-input bg-background px-1 text-center text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                />
                                pts
                              </label>
                              )}
                            </div>
                          </td>
                        ))}
                        {canEdit && (
                          <td className="px-3 py-3 text-right align-top whitespace-nowrap">
                            <button onClick={() => setEditing({ ...d })} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${d.name}`}>
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => { if (confirm(`Delete "${d.name}" and its targets?`)) deleteDefinition.mutate(d.id); }}
                              className="rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              aria-label={`Delete ${d.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {invalid && <p className="text-destructive">Targets must be whole numbers up to 1,000,000.</p>}
              <p>Leave a box empty for no target. A target is per period — a Daily target of 50 means 50 each day, for every agent.</p>
              {showPoints && <p><strong>pts</strong> is what hitting that target is worth on the scoreboard. Points are pro-rata and capped: half the target earns half the points, and beating it earns no more than the target was worth. Leave pts empty to measure a KPI without scoring it.</p>}
              <p>Weeks run Monday to Sunday and quarters are calendar quarters, both on IST dates.</p>
              {data.lastSet && <p>Last updated {new Date(data.lastSet.at).toLocaleString('en-IN')} by {data.lastSet.by}.</p>}
              {!canEdit && <p className="text-amber-600">View only — a Super Admin sets KPIs and targets.</p>}
            </div>
          </section>

          {/* ── Achievement ─────────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <h2 className="text-sm font-semibold">
                Agent achievement <span className="ml-1 font-normal text-muted-foreground">{data.ranges[period]?.label}</span>
              </h2>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
                  {periods.map((p) => (
                    <button key={p.key} onClick={() => setPeriod(p.key)}
                      className={cn('rounded-md px-3 py-1 text-xs font-medium transition-colors',
                        period === p.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted')}>
                      {p.label}
                    </button>
                  ))}
                </div>
                {canExport && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportScores}
                    disabled={data.achievement.length === 0}
                    className="gap-1.5 text-xs"
                  >
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                )}
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-muted/60">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold">Agent</th>
                    {defs.map((d) => (
                      <th key={d.id} className="px-3 py-3 text-center font-semibold whitespace-nowrap">
                        {d.name}
                        <span className="block text-[10px] font-normal text-muted-foreground">
                          {targetFor(d.id) === null ? 'no target' : `target ${targetFor(d.id)}`}
                          {/* Same weighting as the hidden config boxes — showing
                              it here would make hiding them pointless. */}
                          {showPoints && pointsFor(d.id) !== null && ` · ${pointsFor(d.id)} pts`}
                        </span>
                      </th>
                    ))}
                    <th className="px-4 py-3 text-center font-semibold whitespace-nowrap">
                      Score
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        {data.maxScore > 0 ? `out of ${data.maxScore}` : 'no points set'}
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.achievement.length === 0 ? (
                    <tr><td colSpan={defs.length + 2} className="px-4 py-10 text-center text-muted-foreground">No agents to show.</td></tr>
                  ) : data.achievement.map((row) => (
                    <tr key={row.user.id} className="border-t border-border/50 hover:bg-muted/30">
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <div className="font-medium">{row.user.name}</div>
                        {row.user.employeeCode && <div className="font-mono text-[10px] text-muted-foreground">{row.user.employeeCode}</div>}
                      </td>
                      {defs.map((d) => {
                        const actual = row.actuals[d.id];
                        const target = targetFor(d.id);
                        return (
                          <td key={d.id} className="px-3 py-2.5 text-center whitespace-nowrap">
                            {actual === null || actual === undefined ? (
                              <span className="text-xs text-muted-foreground/60">no data</span>
                            ) : target === null ? (
                              <span className="text-xs text-muted-foreground">{actual}</span>
                            ) : (
                              <span className={cn('text-xs font-medium', toneFor(actual, target))}>{actual} / {target}</span>
                            )}
                            {row.scores[d.id] !== null && row.scores[d.id] !== undefined && (
                              <span className="block text-[10px] text-muted-foreground">{row.scores[d.id]} pts</span>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-2.5 text-center whitespace-nowrap">
                        {data.maxScore > 0 ? (
                          <>
                            <span className={cn('text-sm font-bold', toneFor(row.totalScore, data.maxScore))}>
                              {row.totalScore}
                            </span>
                            <span className="text-xs text-muted-foreground"> / {data.maxScore}</span>
                            <span className="block text-[10px] text-muted-foreground">
                              {Math.round((row.totalScore / data.maxScore) * 100)}%
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground/60">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* ── The KPI builder ───────────────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? 'Edit KPI' : 'Add KPI'}</DialogTitle></DialogHeader>
          {editing && data && (() => {
            const src = data.sources.find((s) => s.key === editing.source);
            const set = (patch: Partial<typeof BLANK>) => setEditing({ ...editing, ...patch });
            const toggle = (arr: string[], id: string) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
            return (
              <div className="space-y-4 py-1">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="kpi-name">Name <span className="text-destructive">*</span></Label>
                    <Input id="kpi-name" value={editing.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Walk-Ins Booked" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="kpi-unit">Unit</Label>
                    <Input id="kpi-unit" value={editing.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="calls" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="kpi-source">What should it count? <span className="text-destructive">*</span></Label>
                  <select id="kpi-source" value={editing.source} onChange={(e) => set({ source: e.target.value })} className={SELECT}>
                    {data.sources.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                  </select>
                  {src && <p className="text-[11px] leading-snug text-muted-foreground">{src.help}</p>}
                </div>

                {src?.needs.includes('feedback') && (
                  <>
                    <div className="space-y-1.5">
                      <Label>Feedback categories</Label>
                      <ChipPicker
                        items={data.choices.categories.map((c) => ({ id: c.id, label: c.name }))}
                        selected={editing.feedbackCategoryIds}
                        onToggle={(id) => set({ feedbackCategoryIds: toggle(editing.feedbackCategoryIds, id) })}
                        empty="No categories configured."
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>…or specific feedback options</Label>
                      <ChipPicker
                        items={data.choices.options.map((o) => ({ id: o.id, label: o.label }))}
                        selected={editing.feedbackOptionIds}
                        onToggle={(id) => set({ feedbackOptionIds: toggle(editing.feedbackOptionIds, id) })}
                        empty="No feedback options configured."
                      />
                      <p className="text-[11px] text-muted-foreground">
                        Categories and options are combined with OR. Choose nothing to count every feedback.
                      </p>
                    </div>
                  </>
                )}

                {src?.needs.includes('leadStages') && (
                  <div className="space-y-1.5">
                    <Label>Lead Stages <span className="text-destructive">*</span></Label>
                    <ChipPicker
                      items={data.choices.leadStages.map((s) => ({ id: s, label: s }))}
                      selected={editing.leadStages}
                      onToggle={(id) => set({ leadStages: toggle(editing.leadStages, id) })}
                      empty="No Lead Stages configured in Manage Dropdowns."
                    />
                  </div>
                )}

                {src?.needs.includes('receiptType') && (
                  <div className="space-y-1.5">
                    <Label htmlFor="kpi-receipt">Receipt type <span className="text-destructive">*</span></Label>
                    <select id="kpi-receipt" value={editing.receiptType ?? ''} onChange={(e) => set({ receiptType: e.target.value || null })} className={SELECT}>
                      <option value="">— Select —</option>
                      <option value="APPLICATION">Application</option>
                      <option value="ADMISSION">Admission</option>
                    </select>
                  </div>
                )}

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editing.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
                    Active
                  </label>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="kpi-order" className="text-sm font-normal">Order</Label>
                    <Input id="kpi-order" value={String(editing.sortOrder)} onChange={(e) => set({ sortOrder: Number(e.target.value.replace(/[^\d]/g, '') || 0) })} className="h-8 w-16 text-center" />
                  </div>
                </div>
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              onClick={() => editing && saveDefinition.mutate(editing)}
              disabled={!editing?.name.trim() || saveDefinition.isPending}
            >
              {saveDefinition.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing?.id ? 'Save Changes' : 'Add KPI'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
