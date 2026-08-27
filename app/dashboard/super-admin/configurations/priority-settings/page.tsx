'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Zap, Users, Info, AlertTriangle, Save, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';
import { cn } from '@/lib/utils';

interface Agent { id: string; name: string; employeeCode: string | null }
interface Payload {
  setting: {
    isEnabled: boolean;
    dataCallingTypes: string[];
    agentIds: string[];
    assignedCount: number;
    lastAssignedAt: string | null;
    updatedAt: string | null;
    updatedBy: string | null;
  };
  choices: { dataCallingTypes: string[]; agents: Agent[] };
  activeAgentCount: number;
}

function PrioritySettingsContent() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Payload>({
    queryKey: ['priority-assignment'],
    queryFn: () => fetch('/api/super-admin/priority-assignment').then((r) => r.json()),
  });

  const [enabled, setEnabled] = useState(false);
  const [types, setTypes] = useState<string[]>([]);
  const [agents, setAgents] = useState<string[]>([]);
  const [agentSearch, setAgentSearch] = useState('');
  const [dirty, setDirty] = useState(false);

  // Seeded once the server answers. Not a controlled mirror of the query — the
  // admin's half-finished edits must survive a background refetch.
  useEffect(() => {
    if (!data || dirty) return;
    setEnabled(data.setting.isEnabled);
    setTypes(data.setting.dataCallingTypes);
    setAgents(data.setting.agentIds);
  }, [data, dirty]);

  // Memoised: the `?? []` fallback is a new array each render, which would make
  // the filter below recompute on every keystroke elsewhere on the page.
  const allAgents = useMemo(() => data?.choices.agents ?? [], [data?.choices.agents]);
  const shownAgents = useMemo(() => {
    const q = agentSearch.trim().toLowerCase();
    if (!q) return allAgents;
    return allAgents.filter((a) =>
      a.name.toLowerCase().includes(q) || (a.employeeCode ?? '').toLowerCase().includes(q));
  }, [allAgents, agentSearch]);

  const edit = (fn: () => void) => { fn(); setDirty(true); };
  const allShownSelected = shownAgents.length > 0 && shownAgents.every((a) => agents.includes(a.id));

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch('/api/super-admin/priority-assignment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: enabled, dataCallingTypes: types, agentIds: agents }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Could not save');
      return d as { droppedAgents: number };
    },
    onSuccess: (d) => {
      toast({
        title: enabled ? 'Auto-assign is on' : 'Auto-assign is off',
        description: d.droppedAgents > 0
          ? `${d.droppedAgents} selected agent(s) are no longer active and were not saved.`
          : undefined,
      });
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['priority-assignment'] });
    },
    onError: (e: Error) => toast({ variant: 'destructive', title: 'Not saved', description: e.message }),
  });

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const noTypes = data?.choices.dataCallingTypes.length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 py-2">
      <div className="flex items-start gap-3.5">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg">
          <Zap className="h-6 w-6 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Priority Settings</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">
            Hand incoming leads straight to a chosen set of agents, round-robin, based on their
            Data Calling Type — instead of waiting in the Assign Leads queue.
          </p>
        </div>
      </div>

      {/* Master switch */}
      <div className={cn(
        'flex items-start justify-between gap-4 rounded-2xl border p-4 transition-colors',
        enabled ? 'border-emerald-500/40 bg-emerald-500/[0.06]' : 'border-border/60 bg-card',
      )}>
        <div className="space-y-1">
          <Label htmlFor="pa-enabled" className="text-base font-semibold">Auto-assign incoming leads</Label>
          <p className="text-xs text-muted-foreground">
            {enabled
              ? 'On. A lead arriving with one of the chosen Data Calling Types goes to the next agent in the rotation.'
              : 'Off. Every incoming lead waits in Assign Leads, as before.'}
          </p>
        </div>
        <Switch id="pa-enabled" checked={enabled} onCheckedChange={(v) => edit(() => setEnabled(v))} />
      </div>

      {/* Data Calling Types */}
      <div className="space-y-2 rounded-2xl border border-border/60 bg-card p-4">
        <Label className="text-sm font-semibold">Which Data Calling Types</Label>
        <p className="text-xs text-muted-foreground">
          Only leads carrying one of these are auto-assigned. Everything else is untouched.
        </p>
        {noTypes ? (
          <p className="pt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            No active Data Calling Types exist — add them under Manage Dropdowns → Data Calling Type first.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2 pt-1">
            {data!.choices.dataCallingTypes.map((t) => {
              const on = types.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => edit(() => setTypes((c) => on ? c.filter((x) => x !== t) : [...c, t]))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    on
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground',
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Agents */}
      <div className="space-y-2 rounded-2xl border border-border/60 bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <Label className="text-sm font-semibold">Which agents receive them</Label>
            <p className="text-xs text-muted-foreground">
              Leads are shared out one each, in turn — not all to whoever is least busy.
            </p>
          </div>
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold">
            {agents.length} of {allAgents.length} selected
          </span>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Input
            value={agentSearch}
            onChange={(e) => setAgentSearch(e.target.value)}
            placeholder="Search agents…"
            className="h-9 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => edit(() => setAgents((cur) => {
              const ids = shownAgents.map((a) => a.id);
              // Acts on the search results, so "select all" while filtered does
              // not silently pull in agents the reader cannot see.
              return allShownSelected
                ? cur.filter((id) => !ids.includes(id))
                : Array.from(new Set([...cur, ...ids]));
            }))}
            disabled={shownAgents.length === 0}
          >
            {allShownSelected ? 'Clear' : 'Select all'}
            {agentSearch.trim() && ` (${shownAgents.length})`}
          </Button>
        </div>

        <div className="mt-1 max-h-72 space-y-0.5 overflow-y-auto rounded-lg border border-border/50 p-1">
          {shownAgents.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No agents match that search.</p>
          ) : shownAgents.map((a) => {
            const on = agents.includes(a.id);
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => edit(() => setAgents((c) => on ? c.filter((x) => x !== a.id) : [...c, a.id]))}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted/60',
                  on && 'bg-primary/5',
                )}
              >
                <span className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                  on ? 'border-primary bg-primary' : 'border-input',
                )}>
                  {on && <span className="h-1.5 w-1.5 rounded-[1px] bg-primary-foreground" />}
                </span>
                <span className="flex-1 truncate">{a.name}</span>
                {a.employeeCode && (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{a.employeeCode}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* What it will actually do */}
      {enabled && (
        <div className="rounded-xl border border-border/60 bg-muted/40 p-3 text-xs">
          {types.length === 0 || agents.length === 0 ? (
            <p className="flex items-start gap-2 text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
              Pick at least one Data Calling Type and one agent — otherwise this is on but does nothing.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-muted-foreground">
              <Info className="mt-px h-3.5 w-3.5 shrink-0 text-primary" />
              <span>
                A lead arriving as{' '}
                <strong className="text-foreground">{types.join(' or ')}</strong> goes to the next of{' '}
                <strong className="text-foreground">{agents.length} agent{agents.length === 1 ? '' : 's'}</strong>,
                in turn. Leads uploaded by CSV are assigned the moment they arrive but only reach the
                agent once approved; leads pushed through the API arrive approved and land immediately.
              </span>
            </p>
          )}
        </div>
      )}

      {/* Activity + save */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[11px] text-muted-foreground">
          <RotateCw className="mr-1 inline h-3 w-3" />
          {data!.setting.assignedCount > 0
            ? <>Auto-assigned <strong className="text-foreground">{data!.setting.assignedCount.toLocaleString('en-IN')}</strong> lead(s) so far
                {data!.setting.lastAssignedAt && <>, last {new Date(data!.setting.lastAssignedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</>}.</>
            : 'Nothing auto-assigned yet.'}
          {data!.setting.updatedBy && <> Last changed by {data!.setting.updatedBy}.</>}
        </p>
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save
        </Button>
      </div>

      <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <Users className="mt-px h-3 w-3 shrink-0" />
        An agent who is deactivated drops out of the rotation on their own — the setting does not
        need editing. If every chosen agent goes inactive, leads simply stay unassigned rather than
        being forced somewhere.
      </p>
    </div>
  );
}

export default function Page() {
  return (
    <PinGate action={PIN_GATED_ACTIONS.PRIORITY_ASSIGNMENT} title="Priority Settings">
      <PrioritySettingsContent />
    </PinGate>
  );
}
