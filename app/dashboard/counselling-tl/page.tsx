'use client';

import { useState, useRef, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  UserCheck, UserMinus, Loader2, Search, Shuffle, Clock, X,
  ChevronDown, ChevronUp, ChevronRight, RefreshCw,
  Check, BarChart2, Users, ListFilter,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { LeadDetailModal } from '@/components/leads/lead-detail-modal';
import { PaginationBar } from '@/components/shared/pagination-bar';
import { cn } from '@/lib/utils';
import { usePermissions } from '@/lib/usePermissions';
import { joinCsvFilterValues } from '@/lib/csv-filter-value';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string; name: string; email: string; phone: string;
  city?: string | null; state?: string | null;
  course?: string | null; college?: string | null; campaign?: string | null;
  status: string; createdAt: string;
  assignedTo?: { id: string; name: string } | null;
  assignedBy?: { id: string; name: string } | null;
  feedbacks: unknown[];
  _count: { feedbacks: number };
}

interface Agent { id: string; name: string; managedById?: string | null; _count: { assignedLeads: number } }

type AssignmentFilter = 'all' | 'unassigned' | 'assigned';

interface RRPreviewRow {
  agentId: string;
  name: string;
  current: number;
  willGet: number;
}

function computeRoundRobin(count: number, agents: Agent[]): RRPreviewRow[] {
  if (!agents.length || !count) return [];
  const sorted = [...agents].sort((a, b) => a._count.assignedLeads - b._count.assignedLeads);
  const willGet = new Array(sorted.length).fill(0);
  for (let i = 0; i < count; i++) willGet[i % sorted.length]++;
  return sorted.map((a, i) => ({
    agentId: a.id, name: a.name,
    current: a._count.assignedLeads, willGet: willGet[i],
  }));
}

// ─── Filter chip ──────────────────────────────────────────────────────────────

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-xs font-medium text-primary">
      {label}
      <button onClick={onRemove} className="ml-0.5 rounded-full hover:text-primary/60 transition-colors">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ─── Generic multi-select dropdown ───────────────────────────────────────────

function MultiSelectFilter({
  placeholder,
  options,
  selected,
  onChange,
}: {
  placeholder: string;
  options: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = options.filter((o) => o.toLowerCase().includes(search.toLowerCase()));
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);

  const label =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0]
        : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 min-w-[120px] items-center gap-1.5 rounded-md border px-3 text-xs transition-colors',
          selected.length > 0
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-input bg-background text-muted-foreground hover:bg-muted/50',
        )}
      >
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronDown className={cn('h-3 w-3 shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border bg-background shadow-lg">
          {options.length > 5 && (
            <div className="border-b p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-md bg-muted/40 py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder={`Search…`}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto">
            {selected.length > 0 && (
              <button
                className="w-full border-b px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                onClick={() => onChange([])}
              >
                Clear ({selected.length})
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No results</p>
            ) : (
              filtered.map((o) => {
                const isSelected = selected.includes(o);
                return (
                  <button
                    key={o}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-muted/50',
                      isSelected && 'bg-primary/5',
                    )}
                    onClick={() => toggle(o)}
                  >
                    <div className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      isSelected ? 'border-primary bg-primary' : 'border-input',
                    )}>
                      {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <span className="flex-1 text-left">{o}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── AgentMultiSelect — multi-select agent filter picker ─────────────────────

function AgentMultiSelect({
  agents,
  selected,
  onChange,
}: {
  agents: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => { if (!open) setQ(''); }, [open]);

  const filtered = agents.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id]);

  const label =
    selected.length === 0
      ? 'All Counsellors'
      : selected.length === 1
        ? (agents.find((a) => a.id === selected[0])?.name ?? '1 selected')
        : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 min-w-[120px] items-center gap-1.5 rounded-md border px-3 text-xs transition-colors',
          selected.length > 0
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-input bg-background text-muted-foreground hover:bg-muted/50',
        )}
      >
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronDown className={cn('h-3 w-3 shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border bg-background shadow-lg">
          {agents.length > 5 && (
            <div className="border-b p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="w-full rounded-md bg-muted/40 py-1.5 pl-7 pr-2 text-xs outline-none placeholder:text-muted-foreground"
                  placeholder="Search…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  autoFocus
                />
              </div>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto">
            {selected.length > 0 && (
              <button
                className="w-full border-b px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                onClick={() => onChange([])}
              >
                Clear ({selected.length})
              </button>
            )}
            {filtered.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">No results</p>
            ) : (
              filtered.map((a) => {
                const isSelected = selected.includes(a.id);
                return (
                  <button
                    key={a.id}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-muted/50',
                      isSelected && 'bg-primary/5',
                    )}
                    onClick={() => toggle(a.id)}
                  >
                    <div className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      isSelected ? 'border-primary bg-primary' : 'border-input',
                    )}>
                      {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <span className="flex-1 text-left">{a.name}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── BulkTLSelect — multi-select TL picker for assign bar (SUPER_ADMIN) ──────

function BulkTLSelect({
  tls, selected, onChange,
}: {
  tls: { id: string; name: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useEffect(() => { if (!open) setQ(''); }, [open]);

  const filtered = tls.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id]);

  const label = selected.length === 0
    ? 'Select TL…'
    : selected.length === 1
      ? (tls.find((t) => t.id === selected[0])?.name ?? '1 TL')
      : `${selected.length} TLs selected`;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-7 w-full items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-all',
          selected.length > 0
            ? 'border-blue-400/50 bg-blue-500/20 text-blue-200'
            : 'border-white/15 bg-white/[0.07] text-slate-300 hover:bg-white/[0.12]',
        )}
      >
        <Users className="h-3 w-3 shrink-0 opacity-70" />
        <span className="flex-1 truncate text-left">{label}</span>
        {selected.length > 0 && (
          <span className="flex h-4 min-w-[14px] items-center justify-center rounded-full bg-blue-400/30 px-1 text-[9px] font-bold text-blue-200">
            {selected.length}
          </span>
        )}
        <ChevronDown className={cn('h-3 w-3 opacity-50 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-[60] mb-2 w-60 max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                className="w-full rounded-lg bg-muted/50 py-1.5 pl-8 pr-2 text-xs outline-none placeholder:text-muted-foreground"
                placeholder="Search team leaders…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">No TLs found</p>
            ) : (
              filtered.map((t) => {
                const checked = selected.includes(t.id);
                return (
                  <button
                    key={t.id}
                    onClick={() => toggle(t.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-muted/50',
                      checked && 'bg-blue-500/5',
                    )}
                  >
                    <div className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      checked ? 'border-blue-500 bg-blue-500' : 'border-input',
                    )}>
                      {checked && <Check className="h-2.5 w-2.5 text-white" />}
                    </div>
                    <span className="flex-1 truncate text-left font-medium">{t.name}</span>
                  </button>
                );
              })
            )}
          </div>
          {selected.length > 0 && (
            <div className="border-t p-1.5">
              <button
                onClick={() => onChange([])}
                className="w-full rounded-md py-1 text-xs text-muted-foreground transition-colors hover:text-destructive"
              >
                Clear TL selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BulkAgentSelect — multi-select agent picker for assign bar ───────────────

function BulkAgentSelect({
  agents, selected, onChange, disabled, placeholder,
}: {
  agents: Agent[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  useEffect(() => { if (!open) setQ(''); }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);

  const filtered = agents.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((i) => i !== id) : [...selected, id]);

  const label = selected.length === 0
    ? (placeholder ?? 'Select agents…')
    : selected.length === 1
      ? (agents.find((a) => a.id === selected[0])?.name ?? '1 agent')
      : `${selected.length} agents selected`;

  const maxLoad = Math.max(...agents.map((a) => a._count.assignedLeads), 1);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          'flex h-7 w-full items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-all',
          disabled
            ? 'cursor-not-allowed border-white/[0.06] bg-white/[0.03] text-slate-600'
            : selected.length > 0
              ? 'border-primary/50 bg-primary/25 text-white'
              : 'border-white/15 bg-white/[0.07] text-slate-300 hover:bg-white/[0.12]',
        )}
      >
        <UserCheck className="h-3 w-3 shrink-0 opacity-70" />
        <span className="flex-1 truncate text-left">{label}</span>
        {selected.length > 0 && !disabled && (
          <span className="flex h-4 min-w-[14px] items-center justify-center rounded-full bg-white/20 px-1 text-[9px] font-bold text-white">
            {selected.length}
          </span>
        )}
        {!disabled && <ChevronDown className={cn('h-3 w-3 opacity-50 transition-transform', open && 'rotate-180')} />}
      </button>

      {open && !disabled && (
        <div className="absolute bottom-full left-0 z-[60] mb-2 w-72 max-w-[calc(100vw-3rem)] overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
          {/* Search */}
          <div className="border-b p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                autoFocus
                className="w-full rounded-lg bg-muted/50 py-1.5 pl-8 pr-2 text-xs outline-none placeholder:text-muted-foreground"
                placeholder="Search agents…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          </div>

          {/* Select all / Clear row */}
          <div className="flex items-center justify-between border-b px-3 py-1.5">
            <button
              className="text-xs font-medium text-primary transition-colors hover:text-primary/70"
              onClick={() => onChange(filtered.map((a) => a.id))}
            >
              Select all {filtered.length > 0 ? `(${filtered.length})` : ''}
            </button>
            {selected.length > 0 && (
              <button
                className="text-xs text-muted-foreground transition-colors hover:text-destructive"
                onClick={() => onChange([])}
              >
                Clear
              </button>
            )}
          </div>

          {/* Options */}
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="py-3 text-center text-xs text-muted-foreground">No agents found</p>
            ) : (
              filtered.map((a) => {
                const checked = selected.includes(a.id);
                const pct = Math.round((a._count.assignedLeads / maxLoad) * 100);
                return (
                  <button
                    key={a.id}
                    onClick={() => toggle(a.id)}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2.5 text-sm transition-colors hover:bg-muted/50',
                      checked && 'bg-primary/5',
                    )}
                  >
                    <div className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      checked ? 'border-primary bg-primary' : 'border-input',
                    )}>
                      {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                    <span className="flex-1 truncate text-left font-medium">{a.name}</span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <div className="h-1 w-16 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn('h-full rounded-full transition-all', checked ? 'bg-primary' : 'bg-emerald-400')}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-6 text-right text-xs tabular-nums text-muted-foreground">
                        {a._count.assignedLeads}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Feedback multi-select ────────────────────────────────────────────────────

function FeedbackMultiSelect({
  options, selected, onChange,
}: {
  options: { id: string; label: string }[];
  selected: string[];   // '__fresh__' | feedbackOption.id
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  function toggle(value: string) {
    if (value === '__fresh__') {
      // Fresh is exclusive — selecting it clears all option IDs and vice-versa
      onChange(selected.includes('__fresh__') ? [] : ['__fresh__']);
    } else {
      const withoutFresh = selected.filter((v) => v !== '__fresh__');
      onChange(
        withoutFresh.includes(value)
          ? withoutFresh.filter((v) => v !== value)
          : [...withoutFresh, value],
      );
    }
  }

  const label =
    selected.length === 0
      ? 'All Feedback'
      : selected.length === 1
        ? selected[0] === '__fresh__'
          ? 'Fresh'
          : (options.find((o) => o.id === selected[0])?.label ?? '1 selected')
        : `${selected.length} selected`;

  const allItems = [{ id: '__fresh__', label: 'Fresh (no calls yet)' }, ...options];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-8 min-w-[140px] items-center gap-1.5 rounded-md border px-3 text-xs transition-colors',
          selected.length > 0
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-input bg-background text-muted-foreground hover:bg-muted/50',
        )}
      >
        <span className="flex-1 truncate text-left">{label}</span>
        <ChevronDown className={cn('h-3 w-3 shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-52 rounded-lg border bg-background shadow-lg">
          <div className="max-h-60 overflow-y-auto">
            {selected.length > 0 && (
              <button
                className="w-full border-b px-3 py-1.5 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50"
                onClick={() => onChange([])}
              >
                Clear selection ({selected.length})
              </button>
            )}
            {allItems.map((item) => {
              const isSelected = selected.includes(item.id);
              return (
                <button
                  key={item.id}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-xs transition-colors hover:bg-muted/50',
                    isSelected && 'bg-primary/5',
                  )}
                  onClick={() => toggle(item.id)}
                >
                  <div className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                    isSelected ? 'border-primary bg-primary' : 'border-input',
                  )}>
                    {isSelected && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </div>
                  <span className="flex-1 text-left">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Team load section (collapsible) ─────────────────────────────────────────

function TeamLoadSection({ agents, highlightIds }: { agents: Agent[]; highlightIds: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!agents.length) return null;

  const max = Math.max(...agents.map((a) => a._count.assignedLeads), 1);
  const total = agents.reduce((s, a) => s + a._count.assignedLeads, 0);
  const avg = (total / agents.length).toFixed(1);

  return (
    <div className="overflow-hidden rounded-lg border bg-muted/20">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs transition-colors hover:bg-muted/30"
      >
        <div className="flex min-w-0 items-center gap-2">
          <BarChart2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-semibold uppercase tracking-wider text-muted-foreground">Team Load</span>
          {/* Short summary on phones, full detail from sm up */}
          <span className="truncate text-muted-foreground sm:hidden">
            · {agents.length} agents · {total} leads
          </span>
          <span className="hidden truncate text-muted-foreground sm:inline">
            · {agents.length} counsellors · avg {avg} leads · {total} total assigned
          </span>
        </div>
        {expanded
          ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
          : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="grid grid-cols-2 gap-1.5 border-t p-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {agents.map((a) => {
            const pct = Math.round((a._count.assignedLeads / max) * 100);
            const hl = highlightIds.includes(a.id);
            return (
              <div
                key={a.id}
                className={cn(
                  'rounded-md border px-2.5 py-2',
                  hl ? 'border-primary/50 bg-primary/5' : 'border-slate-200 bg-white',
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-1">
                  <span className="truncate text-xs font-medium" title={a.name}>{a.name}</span>
                  <span className={cn('shrink-0 text-xs font-bold', hl ? 'text-primary' : 'text-muted-foreground')}>
                    {a._count.assignedLeads}
                  </span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={cn('h-full rounded-full transition-all', hl ? 'bg-primary' : 'bg-emerald-400')}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Filter groups for the picker dialog ─────────────────────────────────────

interface FilterDef { key: string; label: string; }

const FILTER_GROUPS: { group: string; filters: FilterDef[] }[] = [
  {
    group: 'Lead Details',
    filters: [
      { key: 'city',     label: 'City'    },
      { key: 'state',    label: 'State'   },
      { key: 'course',   label: 'Course'  },
      { key: 'college',  label: 'College' },
    ],
  },
  {
    group: 'Lead Source',
    filters: [
      { key: 'campaign',   label: 'Lead Code'    },
      { key: 'leadType',   label: 'Lead Type'   },
      { key: 'leadOrigin', label: 'Lead Origin' },
      { key: 'zone',       label: 'Zone'        },
    ],
  },
  {
    group: 'Assignment',
    filters: [
      { key: 'agent', label: 'Counsellor' },
    ],
  },
  {
    group: 'Other',
    filters: [
      { key: 'feedback',  label: 'Last Feedback'    },
      { key: 'createdAt', label: 'Date Added Range' },
      { key: 'updatedAt', label: 'Updated Date Range' },
    ],
  },
];

// ─── Main page ────────────────────────────────────────────────────────────────

export default function CounsellingTLPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { can } = usePermissions();
  const canAssign = can('ASSIGN_LEADS');

  // ── Filters ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [assignmentFilter, setAssignmentFilter] = useState<AssignmentFilter>('all');
  const [cityFilters,       setCityFilters]       = useState<string[]>([]);
  const [stateFilters,      setStateFilters]      = useState<string[]>([]);
  const [campaignFilters,   setCampaignFilters]   = useState<string[]>([]);
  const [courseFilters,     setCourseFilters]     = useState<string[]>([]);
  const [collegeFilters,    setCollegeFilters]    = useState<string[]>([]);
  const [leadTypeFilters,   setLeadTypeFilters]   = useState<string[]>([]);
  const [leadOriginFilters, setLeadOriginFilters] = useState<string[]>([]);
  const [zoneFilters,       setZoneFilters]       = useState<string[]>([]);
  const [feedbackFilter,    setFeedbackFilter]    = useState<string[]>([]);
  const [dateFrom,          setDateFrom]          = useState('');
  const [dateTo,            setDateTo]            = useState('');
  const [updatedFrom,       setUpdatedFrom]       = useState('');
  const [updatedTo,         setUpdatedTo]         = useState('');
  const [agentFilters,      setAgentFilters]      = useState<string[]>([]);
  const [filterDialogOpen,  setFilterDialogOpen]  = useState(false);
  const [dialogFilters,     setDialogFilters]     = useState<string[]>([]);
  const [selectedFilters,   setSelectedFilters]   = useState<string[]>([]);
  const [page,  setPage]  = useState(1);
  const [limit, setLimit] = useState(25);

  // ── Selection ─────────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const lastClickedIdxRef = useRef(-1);

  // ── Dialogs ───────────────────────────────────────────────────────────────────
  const [assignDialogLead, setAssignDialogLead] = useState<Lead | null>(null);
  const [singleAgentId, setSingleAgentId] = useState('');
  const [freshAssign, setFreshAssign] = useState(false);
  const [showRRPreview, setShowRRPreview] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  // ── Bulk assign bar state ─────────────────────────────────────────────────────
  const [bulkTlIds,           setBulkTlIds]           = useState<string[]>([]);
  const [bulkAgentIds,        setBulkAgentIds]        = useState<string[]>([]);
  const [bulkFreshAssign,     setBulkFreshAssign]     = useState(false);
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [loadingAllIds,       setLoadingAllIds]       = useState(false);
  const [rangeFrom,           setRangeFrom]           = useState('');
  const [rangeTo,             setRangeTo]             = useState('');
  const [loadingRange,        setLoadingRange]        = useState(false);

  // Reset page & selection when filters change
  useEffect(() => {
    setPage(1);
    setSelectedIds([]);
    setAllFilteredSelected(false);
    lastClickedIdxRef.current = -1;
  }, [search, assignmentFilter, cityFilters, stateFilters, campaignFilters, courseFilters, collegeFilters, leadTypeFilters, leadOriginFilters, zoneFilters, agentFilters, feedbackFilter, dateFrom, dateTo, updatedFrom, updatedTo, limit]);

  // ── Data queries ──────────────────────────────────────────────────────────────

  const { data: pendingData } = useQuery<{ count: number }>({
    queryKey: ['pending-count'],
    queryFn: () => fetch('/api/leads/pending-count').then((r) => r.json()),
    refetchInterval: 60_000,
  });

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['tl-leads', { search, assignmentFilter, cityFilters, stateFilters, campaignFilters, courseFilters, collegeFilters, leadTypeFilters, leadOriginFilters, zoneFilters, agentFilters, feedbackFilter, dateFrom, dateTo, updatedFrom, updatedTo, page, limit }],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: String(limit), status: 'APPROVED' });
      if (search) p.set('search', search);
      if (assignmentFilter !== 'all') p.set('assignmentStatus', assignmentFilter);
      // joinCsvFilterValues, not a plain .join(',') — a value here (college
      // names especially) can itself contain a literal comma, e.g. "ICFAI
      // Business School (IBS), Hyderabad". See lib/csv-filter-value.ts.
      if (cityFilters.length > 0)       p.set('city',         joinCsvFilterValues(cityFilters));
      if (stateFilters.length > 0)      p.set('state',        joinCsvFilterValues(stateFilters));
      if (campaignFilters.length > 0)   p.set('campaign',     joinCsvFilterValues(campaignFilters));
      if (courseFilters.length > 0)     p.set('course',       joinCsvFilterValues(courseFilters));
      if (collegeFilters.length > 0)    p.set('college',      joinCsvFilterValues(collegeFilters));
      if (leadTypeFilters.length > 0)   p.set('leadType',     joinCsvFilterValues(leadTypeFilters));
      if (leadOriginFilters.length > 0) p.set('leadOrigin',   joinCsvFilterValues(leadOriginFilters));
      if (zoneFilters.length > 0)       p.set('zone',         joinCsvFilterValues(zoneFilters));
      if (agentFilters.length > 0)      p.set('assignedToId', agentFilters.join(','));
      if (feedbackFilter.includes('__fresh__') && feedbackFilter.length === 1) {
        p.set('feedbackTab', 'fresh');
      } else {
        const optIds = feedbackFilter.filter((v) => v !== '__fresh__');
        if (optIds.length > 0) p.set('feedbackOptionIds', optIds.join(','));
      }
      if (dateFrom) p.set('dateFrom', dateFrom);
      if (dateTo)   p.set('dateTo',   dateTo);
      if (updatedFrom) p.set('updatedFrom', updatedFrom);
      if (updatedTo)   p.set('updatedTo',   updatedTo);
      return fetch(`/api/leads?${p}`).then((r) => r.json());
    },
    enabled: !!session?.user?.id,
    placeholderData: (prev) => prev,
  });

  const { data: agents = [], refetch: refetchAgents } = useQuery<Agent[]>({
    queryKey: ['tl-agents', session?.user?.id],
    queryFn: () => fetch('/api/users?role=COUNSELLING_AGENT').then((r) => r.json()),
    enabled: !!session?.user?.id,
  });

  // REPORTS has no team of its own (getLeadWhereClause gives it global
  // visibility, same as SUPER_ADMIN), so it needs the TL-then-agent picker
  // rather than the implicit "my team" behavior COUNSELLING_TL gets.
  const showTlPicker = session?.user?.role === 'SUPER_ADMIN' || session?.user?.role === 'REPORTS';

  const { data: tlsList = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['all-tls-for-assign'],
    queryFn: () => fetch('/api/users?role=COUNSELLING_TL').then((r) => r.json()),
    enabled: showTlPicker && !!session?.user?.id,
    staleTime: 60_000,
  });

  const { data: filterOptions } = useQuery({
    queryKey: ['tl-filter-options'],
    queryFn: () => fetch('/api/leads/filter-options').then((r) => r.json()),
    staleTime: 60_000,
  });

  const { data: feedbackOptions = [] } = useQuery<{ id: string; label: string }[]>({
    queryKey: ['feedback-options'],
    queryFn: () => fetch('/api/feedback-options').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
    enabled: !!session?.user?.id,
  });

  // ── Derived data ──────────────────────────────────────────────────────────────

  const leads: Lead[] = data?.leads ?? [];
  const totalPages: number = data?.totalPages ?? 1;
  const totalCount: number = data?.total ?? 0;
  const unassignedOnPage = leads.filter((l) => !l.assignedTo).length;
  const assignedOnPage   = leads.filter((l) =>  l.assignedTo).length;

  const selectedLeads = useMemo(() => leads.filter((l) => selectedIds.includes(l.id)), [leads, selectedIds]);
  const selUnassigned = selectedLeads.filter((l) => !l.assignedTo).length;
  const selAssigned   = selectedLeads.filter((l) =>  l.assignedTo).length;

  // Agents available in the bulk-assign picker (filtered by selected TL when SUPER_ADMIN)
  const bulkAvailableAgents = useMemo(() => {
    if (!showTlPicker || bulkTlIds.length === 0) return agents;
    return agents.filter((a) => bulkTlIds.includes(a.managedById ?? ''));
  }, [agents, bulkTlIds, showTlPicker]);

  // The pool that will be used for round-robin: specific agents if chosen, else all available
  const rrAgents = useMemo(() => {
    if (bulkAgentIds.length > 0) return agents.filter((a) => bulkAgentIds.includes(a.id));
    return bulkAvailableAgents;
  }, [bulkAgentIds, bulkAvailableAgents, agents]);

  const rrPreview = useMemo(() => computeRoundRobin(selectedIds.length, rrAgents), [selectedIds.length, rrAgents]);

  // Build active filter chips
  const activeFilters = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (assignmentFilter !== 'all') chips.push({
      key: 'assignment',
      label: assignmentFilter.charAt(0).toUpperCase() + assignmentFilter.slice(1),
      onRemove: () => setAssignmentFilter('all'),
    });
    cityFilters.forEach((v)       => chips.push({ key: `city-${v}`,        label: `City: ${v}`,        onRemove: () => setCityFilters((p)       => p.filter((x) => x !== v)) }));
    stateFilters.forEach((v)      => chips.push({ key: `state-${v}`,       label: `State: ${v}`,       onRemove: () => setStateFilters((p)      => p.filter((x) => x !== v)) }));
    campaignFilters.forEach((v)   => chips.push({ key: `campaign-${v}`,    label: `Campaign: ${v}`,    onRemove: () => setCampaignFilters((p)   => p.filter((x) => x !== v)) }));
    courseFilters.forEach((v)     => chips.push({ key: `course-${v}`,      label: `Course: ${v}`,      onRemove: () => setCourseFilters((p)     => p.filter((x) => x !== v)) }));
    collegeFilters.forEach((v)    => chips.push({ key: `college-${v}`,     label: `College: ${v}`,     onRemove: () => setCollegeFilters((p)    => p.filter((x) => x !== v)) }));
    leadTypeFilters.forEach((v)   => chips.push({ key: `leadType-${v}`,    label: `Type: ${v}`,        onRemove: () => setLeadTypeFilters((p)   => p.filter((x) => x !== v)) }));
    leadOriginFilters.forEach((v) => chips.push({ key: `leadOrigin-${v}`,  label: `Origin: ${v}`,      onRemove: () => setLeadOriginFilters((p) => p.filter((x) => x !== v)) }));
    zoneFilters.forEach((v)       => chips.push({ key: `zone-${v}`,        label: `Zone: ${v}`,        onRemove: () => setZoneFilters((p)       => p.filter((x) => x !== v)) }));
    feedbackFilter.forEach((v) => {
      const fbLabel = v === '__fresh__'
        ? 'Fresh'
        : (feedbackOptions.find((o) => o.id === v)?.label ?? v);
      chips.push({ key: `fb-${v}`, label: `Last Feedback: ${fbLabel}`, onRemove: () => setFeedbackFilter((prev) => prev.filter((x) => x !== v)) });
    });
    if (dateFrom) chips.push({ key: 'from', label: `Added From: ${dateFrom}`, onRemove: () => setDateFrom('') });
    if (dateTo)   chips.push({ key: 'to',   label: `Added To: ${dateTo}`,     onRemove: () => setDateTo('') });
    if (updatedFrom) chips.push({ key: 'ufrom', label: `Updated From: ${updatedFrom}`, onRemove: () => setUpdatedFrom('') });
    if (updatedTo)   chips.push({ key: 'uto',   label: `Updated To: ${updatedTo}`,     onRemove: () => setUpdatedTo('') });
    agentFilters.forEach((id) => {
      const agent = agents.find((a) => a.id === id);
      if (agent) chips.push({
        key: id,
        label: agent.name,
        onRemove: () => setAgentFilters((prev) => prev.filter((i) => i !== id)),
      });
    });
    return chips;
  }, [assignmentFilter, cityFilters, stateFilters, campaignFilters, courseFilters, collegeFilters, leadTypeFilters, leadOriginFilters, zoneFilters, feedbackFilter, feedbackOptions, dateFrom, dateTo, updatedFrom, updatedTo, agentFilters, agents]);

  function clearAllFilters() {
    setAssignmentFilter('all');
    setCityFilters([]);
    setStateFilters([]);
    setCampaignFilters([]);
    setCourseFilters([]);
    setCollegeFilters([]);
    setLeadTypeFilters([]);
    setLeadOriginFilters([]);
    setZoneFilters([]);
    setFeedbackFilter([]);
    setDateFrom('');
    setDateTo('');
    setUpdatedFrom('');
    setUpdatedTo('');
    setAgentFilters([]);
    setSelectedFilters([]);
    setDialogFilters([]);
  }

  function openFilterDialog() {
    setDialogFilters(selectedFilters);
    setFilterDialogOpen(true);
  }

  function applyFilterDialog() {
    setSelectedFilters(dialogFilters);
    setFilterDialogOpen(false);
  }

  function toggleDialogFilter(key: string) {
    setDialogFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  // ── Selection helpers ─────────────────────────────────────────────────────────

  function handleRowCheck(e: React.MouseEvent, lead: Lead, idx: number) {
    if (e.shiftKey && lastClickedIdxRef.current !== -1) {
      const lo = Math.min(lastClickedIdxRef.current, idx);
      const hi = Math.max(lastClickedIdxRef.current, idx);
      const rangeIds = leads.slice(lo, hi + 1).map((l) => l.id);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
    } else {
      setSelectedIds((prev) =>
        prev.includes(lead.id) ? prev.filter((id) => id !== lead.id) : [...prev, lead.id],
      );
    }
    lastClickedIdxRef.current = idx;
  }

  const allPageSelected = leads.length > 0 && leads.every((l) => selectedIds.includes(l.id));
  const somePageSelected = leads.some((l) => selectedIds.includes(l.id)) && !allPageSelected;

  function toggleAll() {
    if (allPageSelected) {
      setSelectedIds((prev) => prev.filter((id) => !leads.some((l) => l.id === id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...leads.map((l) => l.id)])));
    }
  }

  function buildFilterParams() {
    const p = new URLSearchParams({ status: 'APPROVED' });
    if (search) p.set('search', search);
    if (assignmentFilter !== 'all') p.set('assignmentStatus', assignmentFilter);
    // joinCsvFilterValues, not a plain .join(',') — see lib/csv-filter-value.ts.
    if (cityFilters.length > 0)       p.set('city',         joinCsvFilterValues(cityFilters));
    if (stateFilters.length > 0)      p.set('state',        joinCsvFilterValues(stateFilters));
    if (campaignFilters.length > 0)   p.set('campaign',     joinCsvFilterValues(campaignFilters));
    if (courseFilters.length > 0)     p.set('course',       joinCsvFilterValues(courseFilters));
    if (collegeFilters.length > 0)    p.set('college',      joinCsvFilterValues(collegeFilters));
    if (leadTypeFilters.length > 0)   p.set('leadType',     joinCsvFilterValues(leadTypeFilters));
    if (leadOriginFilters.length > 0) p.set('leadOrigin',   joinCsvFilterValues(leadOriginFilters));
    if (zoneFilters.length > 0)       p.set('zone',         joinCsvFilterValues(zoneFilters));
    if (agentFilters.length > 0)      p.set('assignedToId', agentFilters.join(','));
    if (feedbackFilter.includes('__fresh__') && feedbackFilter.length === 1) {
      p.set('feedbackTab', 'fresh');
    } else {
      const optIds = feedbackFilter.filter((v) => v !== '__fresh__');
      if (optIds.length > 0) p.set('feedbackOptionIds', optIds.join(','));
    }
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo)   p.set('dateTo',   dateTo);
    if (updatedFrom) p.set('updatedFrom', updatedFrom);
    if (updatedTo)   p.set('updatedTo',   updatedTo);
    return p;
  }

  async function selectAllFiltered() {
    setLoadingAllIds(true);
    try {
      const res = await fetch(`/api/leads/ids?${buildFilterParams()}`);
      const data = await res.json();
      if (data.ids) {
        setSelectedIds(data.ids);
        setAllFilteredSelected(true);
      }
    } finally {
      setLoadingAllIds(false);
    }
  }

  async function selectRange() {
    const from = parseInt(rangeFrom, 10);
    const to   = parseInt(rangeTo, 10);
    if (!from || !to || from < 1 || to < from || from > totalCount) return;
    const skip = from - 1;
    const take = Math.min(to - from + 1, 10000);
    setLoadingRange(true);
    try {
      const p = buildFilterParams();
      p.set('skip',  String(skip));
      p.set('limit', String(take));
      const res  = await fetch(`/api/leads/ids?${p}`);
      const data = await res.json();
      if (data.ids && data.ids.length > 0) {
        setSelectedIds((prev) => Array.from(new Set([...prev, ...data.ids])));
        toast({ title: `${data.ids.length} lead${data.ids.length !== 1 ? 's' : ''} selected (rows ${from}–${from + data.ids.length - 1})` });
      }
    } finally {
      setLoadingRange(false);
    }
  }

  function clearSelection() {
    setSelectedIds([]);
    setBulkTlIds([]);
    setBulkAgentIds([]);
    setBulkFreshAssign(false);
    setAllFilteredSelected(false);
    lastClickedIdxRef.current = -1;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────────

  const singleAssignMutation = useMutation({
    mutationFn: ({ leadId, agentId, resetFeedbacks }: { leadId: string; agentId: string; resetFeedbacks?: boolean }) =>
      fetch(`/api/leads/${leadId}/assign`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, ...(resetFeedbacks ? { resetFeedbacks: true } : {}) }),
      }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.error) { toast({ variant: 'destructive', title: 'Error', description: d.error }); return; }
      toast({ title: 'Lead assigned' });
      qc.invalidateQueries({ queryKey: ['tl-leads'] });
      refetchAgents();
      setAssignDialogLead(null);
    },
  });

  const autoAssignMutation = useMutation({
    mutationFn: ({ leadIds, agentIds, resetFeedbacks }: { leadIds: string[]; agentIds?: string[]; resetFeedbacks?: boolean }) =>
      fetch('/api/leads/auto-assign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds, agentIds, ...(resetFeedbacks ? { resetFeedbacks: true } : {}) }),
      }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.success === false) { toast({ variant: 'destructive', title: 'Assignment failed', description: d.error }); return; }
      const total = d.summary?.reduce((s: number, x: { assigned: number }) => s + x.assigned, 0) ?? 0;
      toast({ title: `${total} lead${total !== 1 ? 's' : ''} assigned successfully` });
      qc.invalidateQueries({ queryKey: ['tl-leads'] });
      refetchAgents();
      clearSelection();
      setShowRRPreview(false);
    },
    onError: () => toast({ variant: 'destructive', title: 'Error', description: 'Failed to assign leads' }),
  });

  const unassignMutation = useMutation({
    mutationFn: (leadIds: string[]) =>
      fetch('/api/leads/bulk-unassign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds }),
      }).then((r) => r.json()),
    onSuccess: (d) => {
      if (d.success === false) { toast({ variant: 'destructive', title: 'Unassign failed', description: d.error }); return; }
      toast({ title: `${d.unassigned} lead${d.unassigned !== 1 ? 's' : ''} moved back to unassigned` });
      qc.invalidateQueries({ queryKey: ['tl-leads'] });
      refetchAgents();
      clearSelection();
      setAssignDialogLead(null);
    },
    onError: () => toast({ variant: 'destructive', title: 'Error', description: 'Failed to unassign leads' }),
  });

  const pendingCount = pendingData?.count ?? 0;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col gap-4 pb-24">

      {/* Pending banner */}
      {pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <Clock className="h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-800">
            <span className="font-semibold">{pendingCount} lead{pendingCount !== 1 ? 's' : ''}</span>{' '}
            pending Reports approval — not yet available for assignment.
          </p>
        </div>
      )}

      <Card className="flex min-h-0 flex-1 flex-col">
        <CardHeader className="space-y-3 pb-3 shrink-0">

          {/* ── Row 1: Search + status + controls ── */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search leads…"
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {/* Assignment status toggle — full-width segmented control on phones */}
            <div className="flex w-full sm:w-auto overflow-hidden rounded-lg border text-sm shrink-0">
              {(['all', 'unassigned', 'assigned'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setAssignmentFilter(v)}
                  className={cn(
                    'flex-1 sm:flex-none px-3 py-1.5 font-medium capitalize transition-colors',
                    assignmentFilter === v
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted/50',
                  )}
                >
                  {v}
                </button>
              ))}
            </div>

            <Button
              variant="outline" size="sm"
              onClick={openFilterDialog}
              className={cn('flex-1 sm:flex-none', selectedFilters.length > 0 && 'border-primary text-primary')}
            >
              <ListFilter className="mr-1.5 h-3.5 w-3.5" />
              Filters
              {selectedFilters.length > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-4 min-w-4 px-1 text-[10px]">
                  {selectedFilters.length}
                </Badge>
              )}
            </Button>

            <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
            </Button>

            {activeFilters.length > 0 && (
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearAllFilters}>
                <X className="mr-1 h-3.5 w-3.5" /> Clear all
              </Button>
            )}
          </div>

          {/* ── Active selected filters ── */}
          {selectedFilters.length > 0 && (
            <div className="flex flex-wrap gap-3 rounded-lg border border-border/60 bg-muted/10 p-3 items-end">
              {selectedFilters.includes('city') && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">City</span>
                  <MultiSelectFilter placeholder="All Cities" options={filterOptions?.cities ?? []} selected={cityFilters} onChange={setCityFilters} />
                </div>
              )}
              {selectedFilters.includes('state') && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">State</span>
                  <MultiSelectFilter placeholder="All States" options={filterOptions?.states ?? []} selected={stateFilters} onChange={setStateFilters} />
                </div>
              )}
              {selectedFilters.includes('course') && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Course</span>
                  <MultiSelectFilter placeholder="All Courses" options={filterOptions?.courses ?? []} selected={courseFilters} onChange={setCourseFilters} />
                </div>
              )}
              {selectedFilters.includes('college') && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">College</span>
                  <MultiSelectFilter placeholder="All Colleges" options={filterOptions?.colleges ?? []} selected={collegeFilters} onChange={setCollegeFilters} />
                </div>
              )}
              {selectedFilters.includes('campaign') && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Code</span>
                  <MultiSelectFilter placeholder="All Campaigns" options={filterOptions?.campaigns ?? []} selected={campaignFilters} onChange={setCampaignFilters} />
                </div>
              )}
              {selectedFilters.includes('leadType') && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Type</span>
                  <MultiSelectFilter placeholder="All Types" options={filterOptions?.leadTypes ?? []} selected={leadTypeFilters} onChange={setLeadTypeFilters} />
                </div>
              )}
              {selectedFilters.includes('leadOrigin') && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Origin</span>
                  <MultiSelectFilter placeholder="All Origins" options={filterOptions?.leadOrigins ?? []} selected={leadOriginFilters} onChange={setLeadOriginFilters} />
                </div>
              )}
              {selectedFilters.includes('zone') && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Zone</span>
                  <MultiSelectFilter placeholder="All Zones" options={filterOptions?.leadZones ?? []} selected={zoneFilters} onChange={setZoneFilters} />
                </div>
              )}
              {selectedFilters.includes('agent') && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Counsellor</span>
                  <AgentMultiSelect agents={agents} selected={agentFilters} onChange={setAgentFilters} />
                </div>
              )}
              {selectedFilters.includes('feedback') && (
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Last Feedback</span>
                  <FeedbackMultiSelect options={feedbackOptions} selected={feedbackFilter} onChange={setFeedbackFilter} />
                </div>
              )}
              {selectedFilters.includes('createdAt') && (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Date Added From</span>
                    <Input type="date" className="h-8 w-36 text-xs" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Date Added To</span>
                    <Input type="date" className="h-8 w-36 text-xs" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} />
                  </div>
                </>
              )}
              {selectedFilters.includes('updatedAt') && (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Updated From</span>
                    <Input type="date" className="h-8 w-36 text-xs" value={updatedFrom} onChange={(e) => setUpdatedFrom(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Updated To</span>
                    <Input type="date" className="h-8 w-36 text-xs" value={updatedTo} min={updatedFrom || undefined} onChange={(e) => setUpdatedTo(e.target.value)} />
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── Active filter chips ── */}
          {activeFilters.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {activeFilters.map((f) => (
                <FilterChip key={f.key} label={f.label} onRemove={f.onRemove} />
              ))}
            </div>
          )}

          {/* ── Team load (collapsible) ── */}
          <TeamLoadSection agents={agents} highlightIds={agentFilters} />

          {/* ── Stats strip ── */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:gap-4 text-xs text-muted-foreground">
            <span className="whitespace-nowrap">{totalCount} total</span>
            <span className="whitespace-nowrap font-medium text-amber-600">{unassignedOnPage} unassigned on page</span>
            <span className="whitespace-nowrap font-medium text-emerald-600">{assignedOnPage} assigned on page</span>
            {isFetching && (
              <span className="flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />Updating…
              </span>
            )}

            {/* ── Range selector ── */}
            {canAssign && totalCount > 0 && (
              <span className="flex w-full items-center gap-1.5 sm:w-auto sm:ml-auto">
                <span className="text-muted-foreground/70">Select rows</span>
                <input
                  type="number"
                  min={1}
                  max={totalCount}
                  placeholder="From"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  className="w-16 h-6 rounded border border-input bg-background px-1.5 text-xs text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-muted-foreground">–</span>
                <input
                  type="number"
                  min={1}
                  max={totalCount}
                  placeholder="To"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') selectRange(); }}
                  className="w-16 h-6 rounded border border-input bg-background px-1.5 text-xs text-center [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button
                  onClick={selectRange}
                  disabled={loadingRange || !rangeFrom || !rangeTo}
                  className="h-6 rounded bg-primary/10 px-2 text-xs font-medium text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                >
                  {loadingRange ? '…' : 'Select'}
                </button>
              </span>
            )}
          </div>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col p-0">
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className={cn('flex-1 overflow-auto', isFetching && 'opacity-60 transition-opacity')}>
              <table className="w-full caption-bottom text-sm border-collapse">
                <thead className="sticky top-0 z-20 bg-card">
                  <tr className="border-b border-border/60 bg-muted/30">
                    {canAssign && (
                      <th className="w-10 pl-4 py-3 text-left">
                        <input
                          type="checkbox"
                          className="rounded accent-primary"
                          checked={allPageSelected}
                          ref={(el) => { if (el) el.indeterminate = somePageSelected; }}
                          onChange={toggleAll}
                        />
                      </th>
                    )}
                    <th className="w-10 px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Sr No.</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Name</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Phone</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">City</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Course</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">College</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Lead Code</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Assigned To</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Calls</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Added</th>
                    {canAssign && <th className="pr-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap">Actions</th>}
                  </tr>
                </thead>
                <tbody className="[&_tr:last-child]:border-0">
                  {/* ── Select-all-filtered banner ── */}
                  {canAssign && allPageSelected && totalCount > leads.length && (
                    <tr>
                      <td
                        colSpan={canAssign ? 12 : 11}
                        className="border-b border-primary/20 bg-primary/5 py-2 text-center text-xs"
                      >
                        {allFilteredSelected ? (
                          <span className="text-primary font-medium">
                            All <strong>{totalCount.toLocaleString()}</strong> leads matching current filters are selected.{' '}
                            <button
                              className="underline hover:no-underline text-primary font-semibold"
                              onClick={clearSelection}
                            >
                              Clear selection
                            </button>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">
                            All <strong>{leads.length}</strong> leads on this page are selected.{' '}
                            <button
                              className="underline hover:no-underline text-primary font-semibold disabled:opacity-50"
                              onClick={selectAllFiltered}
                              disabled={loadingAllIds}
                            >
                              {loadingAllIds
                                ? 'Loading…'
                                : `Select all ${totalCount.toLocaleString()} leads matching current filters`}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                  {leads.map((lead, idx) => {
                    const isSelected = selectedIds.includes(lead.id);
                    const srNo = (page - 1) * limit + idx + 1;
                    return (
                      <tr
                        key={lead.id}
                        className={cn(
                          'border-b border-border/60 transition-colors hover:bg-muted/50',
                          isSelected && 'bg-primary/5 hover:bg-primary/10',
                        )}
                      >
                        {canAssign && (
                          <td className="w-10 pl-4 py-3">
                            <input
                              type="checkbox"
                              className="cursor-pointer rounded accent-primary"
                              checked={isSelected}
                              onClick={(e) => handleRowCheck(e, lead, idx)}
                              onChange={() => {}}
                            />
                          </td>
                        )}
                        <td className="px-4 py-3 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{srNo}</td>
                        <td
                          className="px-4 py-3 cursor-pointer font-medium hover:text-primary whitespace-nowrap max-w-[220px] truncate"
                          onClick={() => setSelectedLead(lead)}
                        >
                          {lead.name}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{lead.phone}</td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap">{lead.city ?? '—'}</td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap max-w-[200px] truncate">{lead.course ?? '—'}</td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap max-w-[220px] truncate" title={lead.college ?? undefined}>{lead.college ?? '—'}</td>
                        <td className="px-4 py-3 text-sm whitespace-nowrap max-w-[200px] truncate">{lead.campaign ?? '—'}</td>
                        <td className="px-4 py-3">
                          {lead.assignedTo ? (
                            <Badge variant="info" className="text-xs">{lead.assignedTo.name}</Badge>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                              Unassigned
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <div
                                key={i}
                                className={cn('h-1.5 w-3 rounded-sm', i < lead._count.feedbacks ? 'bg-primary' : 'bg-muted')}
                              />
                            ))}
                            <span className="ml-1 text-xs text-muted-foreground">{lead._count.feedbacks}/5</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {new Date(lead.createdAt).toLocaleDateString('en-GB')}
                        </td>
                        {canAssign && (
                          <td className="pr-4 py-3 text-right">
                            <Button
                              size="sm"
                              variant={lead.assignedTo ? 'outline' : 'default'}
                              className="h-7 text-xs"
                              onClick={() => {
                                setAssignDialogLead(lead);
                                setSingleAgentId(lead.assignedTo?.id ?? '');
                                setFreshAssign(false);
                              }}
                            >
                              {lead.assignedTo ? 'Reassign' : 'Assign'}
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {leads.length === 0 && (
                    <tr>
                      <td
                        colSpan={canAssign ? 12 : 11}
                        className="py-12 text-center text-muted-foreground"
                      >
                        No approved leads match your filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination — always visible, pinned below the scrollable table */}
          {!isLoading && (
            <PaginationBar
              page={page}
              totalPages={totalPages}
              total={totalCount}
              limit={limit}
              onPageChange={(p) => { setPage(p); setSelectedIds([]); lastClickedIdxRef.current = -1; }}
              onLimitChange={(l) => { setLimit(l); setPage(1); setSelectedIds([]); lastClickedIdxRef.current = -1; }}
              disabled={isFetching}
              className="shrink-0 border-t px-4"
            />
          )}
        </CardContent>
      </Card>

      {/* ── Floating bulk-assign bar ──────────────────────────────────────────── */}
      {canAssign && selectedIds.length > 0 && (
        <div className="fixed bottom-4 sm:bottom-6 left-1/2 z-50 w-[calc(100%-1.5rem)] sm:w-[calc(100%-2rem)] max-w-6xl -translate-x-1/2">
          {/* Wraps into stacked rows on phones; single row from sm up */}
          <div className="relative flex flex-wrap items-center gap-x-2 gap-y-2.5 sm:gap-x-2.5 rounded-2xl bg-[#0f1117] px-3 sm:px-4 py-3 sm:pr-12 shadow-[0_20px_60px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.08]">

            {/* Count + summary — own full row on mobile, with the close button on its right */}
            <div className="flex w-full sm:w-auto items-center gap-2.5 sm:shrink-0">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                {selectedIds.length}
              </div>
              <div className="leading-tight">
                <p className="text-xs font-semibold text-white">{selectedIds.length} lead{selectedIds.length !== 1 ? 's' : ''} selected</p>
                <p className="text-[10px] text-slate-500">
                  {allFilteredSelected ? 'All matching' : `${selUnassigned} unassigned · ${selAssigned} assigned`}
                </p>
              </div>
              <button
                onClick={clearSelection}
                className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-slate-500 transition-all hover:bg-white/10 hover:text-slate-200 sm:hidden"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="hidden sm:block h-6 w-px bg-white/[0.08] shrink-0" />

            {/* TL picker */}
            {showTlPicker && (
              <>
                <div className="flex-1 min-w-[130px] sm:flex-none sm:w-36 sm:shrink-0">
                  <BulkTLSelect
                    tls={tlsList}
                    selected={bulkTlIds}
                    onChange={(ids) => { setBulkTlIds(ids); setBulkAgentIds([]); }}
                  />
                </div>
                <ChevronRight className="hidden sm:block h-3 w-3 text-slate-600 shrink-0" />
              </>
            )}

            {/* Agent picker */}
            <div className="flex-1 min-w-[150px] sm:flex-none sm:w-44 sm:shrink-0">
              <BulkAgentSelect
                agents={bulkAvailableAgents}
                selected={bulkAgentIds}
                onChange={setBulkAgentIds}
                disabled={showTlPicker && bulkTlIds.length === 0}
                placeholder={
                  showTlPicker && bulkTlIds.length === 0
                    ? 'Select TL first…'
                    : bulkAvailableAgents.length > 0
                      ? `All ${bulkAvailableAgents.length} agents`
                      : 'No agents'
                }
              />
            </div>

            {/* Fresh toggle */}
            <button
              type="button"
              onClick={() => setBulkFreshAssign((v) => !v)}
              className={cn(
                'flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[11px] font-semibold tracking-wider uppercase transition-all',
                bulkFreshAssign
                  ? 'border-red-500/50 bg-red-500/15 text-red-300'
                  : 'border-white/10 bg-transparent text-slate-500 hover:border-white/20 hover:text-slate-300',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', bulkFreshAssign ? 'bg-red-400' : 'bg-slate-600')} />
              Fresh
            </button>

            <div className="hidden sm:block h-6 w-px bg-white/[0.08] shrink-0" />

            {/* Assign */}
            {bulkAgentIds.length > 0 && (
              <button
                disabled={autoAssignMutation.isPending}
                onClick={() => autoAssignMutation.mutate({ leadIds: selectedIds, agentIds: bulkAgentIds, resetFeedbacks: bulkFreshAssign })}
                className={cn(
                  'flex h-8 flex-1 sm:flex-none justify-center shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold text-white transition-all hover:brightness-110 disabled:opacity-50',
                  bulkFreshAssign ? 'bg-red-500' : 'bg-primary',
                )}
              >
                {autoAssignMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserCheck className="h-3 w-3" />}
                {bulkFreshAssign ? 'Assign Fresh' : `Assign (${bulkAgentIds.length})`}
              </button>
            )}

            {/* Redistribute */}
            <button
              disabled={rrAgents.length === 0 || autoAssignMutation.isPending}
              onClick={() => setShowRRPreview(true)}
              className={cn(
                'flex h-8 flex-1 sm:flex-none justify-center shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all disabled:opacity-40',
                bulkAgentIds.length > 0
                  ? 'border border-white/10 bg-white/[0.06] text-slate-300 hover:bg-white/10'
                  : bulkFreshAssign
                    ? 'bg-red-500 text-white hover:brightness-110'
                    : 'bg-primary text-white hover:brightness-110',
              )}
            >
              <Shuffle className="h-3 w-3" />
              {bulkAgentIds.length > 0 ? 'Redistribute' : `Round-Robin${rrAgents.length > 0 ? ` (${rrAgents.length})` : ''}`}
            </button>

            {/* Unassign */}
            {(selAssigned > 0 || allFilteredSelected) && (
              <button
                disabled={unassignMutation.isPending}
                onClick={() => {
                  const ids = allFilteredSelected
                    ? selectedIds
                    : selectedLeads.filter((l) => l.assignedTo).map((l) => l.id);
                  if (ids.length > 0) unassignMutation.mutate(ids);
                }}
                className="flex h-8 flex-1 sm:flex-none justify-center shrink-0 items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-semibold text-amber-300 transition-all hover:bg-amber-500/20 disabled:opacity-50"
              >
                {unassignMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <UserMinus className="h-3 w-3" />}
                {allFilteredSelected ? 'Unassign' : `Unassign (${selAssigned})`}
              </button>
            )}

            {/* Close — desktop only, pinned to the corner so wrapped rows stay tidy;
                mobile has its own X in the count row above */}
            <button
              onClick={clearSelection}
              className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-slate-500 transition-all hover:bg-white/10 hover:text-slate-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── Single-lead assign / reassign dialog ─────────────────────────────── */}
      <Dialog open={!!assignDialogLead} onOpenChange={(v) => { if (!v) { setAssignDialogLead(null); setFreshAssign(false); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {assignDialogLead?.assignedTo ? 'Reassign' : 'Assign'}: {assignDialogLead?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {assignDialogLead?.assignedTo && (
              <div className="flex items-center gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                Currently assigned to{' '}
                <span className="ml-1 font-semibold text-foreground">{assignDialogLead.assignedTo.name}</span>
              </div>
            )}
            {assignDialogLead?.assignedTo && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 cursor-pointer accent-destructive"
                  checked={freshAssign}
                  onChange={(e) => setFreshAssign(e.target.checked)}
                />
                <div>
                  <p className="text-xs font-semibold text-destructive">Reassign as fresh lead</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    All previous follow-ups and scheduled calls for this lead will be permanently deleted.
                  </p>
                </div>
              </label>
            )}
            <p className="text-sm text-muted-foreground">Select agent — lead count shown:</p>
            <div className="max-h-52 overflow-y-auto space-y-1.5 pr-1">
              {agents.map((a) => {
                const isSelected = singleAgentId === a.id;
                const max = Math.max(...agents.map((x) => x._count.assignedLeads), 1);
                return (
                  <button
                    key={a.id}
                    onClick={() => setSingleAgentId(a.id)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors',
                      isSelected ? 'border-primary bg-primary/5' : 'border-input hover:bg-muted/40',
                    )}
                  >
                    <span className="font-medium">{a.name}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-emerald-400"
                          style={{ width: `${Math.round((a._count.assignedLeads / max) * 100)}%` }}
                        />
                      </div>
                      <span className="w-8 text-right text-xs text-muted-foreground">{a._count.assignedLeads}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAssignDialogLead(null)}>Cancel</Button>
            {assignDialogLead?.assignedTo && (
              <Button
                variant="destructive"
                disabled={unassignMutation.isPending}
                onClick={() => unassignMutation.mutate([assignDialogLead!.id])}
              >
                {unassignMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <UserMinus className="mr-1.5 h-4 w-4" /> Unassign
              </Button>
            )}
            <Button
              disabled={!singleAgentId || singleAssignMutation.isPending}
              onClick={() => singleAssignMutation.mutate({ leadId: assignDialogLead!.id, agentId: singleAgentId, resetFeedbacks: freshAssign })}
            >
              {singleAssignMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {assignDialogLead?.assignedTo
                ? freshAssign ? 'Reassign as Fresh' : 'Reassign'
                : 'Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Round-robin preview dialog ───────────────────────────────────────── */}
      <Dialog open={showRRPreview} onOpenChange={setShowRRPreview}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shuffle className={cn('h-4 w-4', bulkFreshAssign ? 'text-destructive' : 'text-primary')} />
              Round-Robin Distribution Preview
              {bulkFreshAssign && (
                <span className="ml-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-destructive">
                  Fresh
                </span>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {bulkFreshAssign && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
                <span className="font-semibold">Fresh Reassign:</span>
                <span>All previous follow-ups and scheduled calls for these {selectedIds.length} leads will be permanently deleted.</span>
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">{selectedIds.length} leads</span> will be
              distributed across{' '}
              <span className="font-semibold text-foreground">{rrAgents.length} agent{rrAgents.length !== 1 ? 's' : ''}</span>
              {bulkAgentIds.length > 0 ? ' (selected agents)' : bulkAvailableAgents.length < agents.length ? ' (from selected TL)' : ''}{' '}
              starting from the agent with the lowest current load.
            </p>
            <div className="overflow-hidden rounded-lg border">
              <div className="grid grid-cols-4 gap-2 bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="col-span-2">Agent</span>
                <span className="text-center">Current</span>
                <span className="text-center">+New → Total</span>
              </div>
              {rrPreview.map((row) => (
                <div key={row.agentId} className="grid grid-cols-4 items-center gap-2 border-t px-3 py-2.5 text-sm">
                  <span className="col-span-2 font-medium">{row.name}</span>
                  <span className="text-center text-muted-foreground">{row.current}</span>
                  <span className="text-center">
                    {row.willGet > 0
                      ? <span className="font-semibold text-emerald-700">+{row.willGet} → {row.current + row.willGet}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Agents are sorted by current lead count (fewest first) to balance workload evenly.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRRPreview(false)}>Cancel</Button>
            <Button
              onClick={() => autoAssignMutation.mutate({ leadIds: selectedIds, agentIds: bulkAgentIds.length > 0 ? bulkAgentIds : undefined, resetFeedbacks: bulkFreshAssign })}
              disabled={autoAssignMutation.isPending}
            >
              {autoAssignMutation.isPending
                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                : <Shuffle className="mr-2 h-4 w-4" />}
              {bulkFreshAssign ? 'Confirm Fresh Auto-Assign' : 'Confirm Auto-Assign'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LeadDetailModal
        lead={selectedLead as Parameters<typeof LeadDetailModal>[0]['lead']}
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        canUnmask
      />

      {/* ── Filter picker dialog ── */}
      <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListFilter className="h-4 w-4" />
              Filters
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select the filters you want to use. They&apos;ll appear below the toolbar.
            </p>
          </DialogHeader>

          <div className="py-2 space-y-5 max-h-[60vh] overflow-y-auto pr-1">
            {FILTER_GROUPS.map(({ group, filters }) => {
              const allChecked = filters.every((f) => dialogFilters.includes(f.key));
              return (
                <div key={group}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {group}
                    </span>
                    <button
                      onClick={() => {
                        if (allChecked) {
                          setDialogFilters((prev) => prev.filter((k) => !filters.map((f) => f.key).includes(k)));
                        } else {
                          setDialogFilters((prev) => Array.from(new Set([...prev, ...filters.map((f) => f.key)])));
                        }
                      }}
                      className="text-[10px] text-primary hover:underline"
                    >
                      {allChecked ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {filters.map((f) => {
                      const checked = dialogFilters.includes(f.key);
                      return (
                        <label
                          key={f.key}
                          className={cn(
                            'flex items-center gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors text-sm select-none',
                            checked
                              ? 'border-primary/60 bg-primary/8 text-primary'
                              : 'border-input hover:bg-muted/40'
                          )}
                        >
                          <input
                            type="checkbox"
                            className="rounded border-border accent-primary"
                            checked={checked}
                            onChange={() => toggleDialogFilter(f.key)}
                          />
                          {f.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={() => setDialogFilters([])}>
              Reset
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFilterDialogOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={applyFilterDialog}>
              Apply Filters
              {dialogFilters.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary-foreground/20 text-[10px] font-bold">
                  {dialogFilters.length}
                </span>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
