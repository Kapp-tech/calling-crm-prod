'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp, Users, UserCheck, UserX, PhoneCall, PhoneMissed,
  GraduationCap, Award, Search, RotateCcw, SlidersHorizontal, X,
  CalendarDays, ChevronDown, CheckSquare, Square, Check,
  MapPin, Map, BookOpen, Tag, Globe2, Megaphone, User, MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sparkline } from '@/components/shared/sparkline';
import { Leaderboard } from '@/components/shared/leaderboard';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DashboardStats {
  totalLeads?: number;
  assignedLeads?: number;
  unassignedLeads?: number;
  connectedLeads?: number;
  untouchedLeads?: number;
  applications?: number;
  admissions?: number;
  activeAgents?: number;
  activeTLs?: number;
  pendingLeads?: number;
  approvedLeads?: number;
  disapprovedLeads?: number;
  feedbackBreakdown?: { label: string; count: number }[];
  topAgents?: { name: string; callCount: number; todayCount: number }[];
  leadsOverTime?: { date: string; count: number }[];
  sparklines?: { totalLeads?: number[]; assignedLeads?: number[]; connectedLeads?: number[] };
}

interface FilterOptions {
  campaigns: string[];
  leadTypes: string[];
  leadOrigins: string[];
  leadZones: string[];
  cities: string[];
  states: string[];
  colleges: string[];
  courses: string[];
}

interface AgentUser {
  id: string;
  name: string;
}

interface FeedbackOption {
  id: string;
  label: string;
}

type QuickFilter = 'today' | 'week' | 'month' | '3months' | 'alltime' | 'custom';

interface Filters {
  assignedToId: string[];
  city: string[];
  state: string[];
  course: string[];
  leadType: string[];
  leadOrigin: string[];
  campaign: string[];
  feedback: string[];
}

const EMPTY_FILTERS: Filters = {
  assignedToId: [], city: [], state: [],
  course: [], leadType: [], leadOrigin: [], campaign: [], feedback: [],
};

const QUICK_FILTERS: { key: QuickFilter; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: '3months', label: 'Last 3 Months' },
  { key: 'alltime', label: 'All Time' },
  { key: 'custom', label: 'Custom Range' },
];

const DEFAULT_CARD_KEYS = ['totalLeads', 'assignedLeads', 'unassignedLeads', 'connectedLeads', 'untouchedLeads'];

const EXTRA_CARD_OPTIONS = [
  { key: 'applications', label: 'Applications' },
  { key: 'admissions', label: 'Admissions' },
  { key: 'activeAgents', label: 'Active Agents' },
];

const STATUS_PIE_COLORS = ['#10b981', '#f59e0b', '#ef4444'];
const FEEDBACK_COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#06b6d4', '#f59e0b', '#10b981', '#f43f5e', '#64748b'];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return d.toISOString().split('T')[0];
}

function getQuickRange(filter: QuickFilter): { from: string; to: string } {
  if (filter === 'alltime' || filter === 'custom') return { from: '', to: '' };
  const today = new Date();
  const days: Record<string, number> = { today: 0, week: 7, month: 30, '3months': 90 };
  const from = new Date(today);
  from.setDate(from.getDate() - (days[filter] ?? 0));
  return { from: fmtDate(from), to: fmtDate(today) };
}

function formatNum(n: number = 0) {
  return n.toLocaleString('en-IN');
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function fmtChartDate(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
}

// ─── useCountUp ──────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 750) {
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = displayRef.current;
    if (from === target) return;

    const startTime = performance.now();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const eased = 1 - (1 - t) ** 3; // ease-out cubic
      const val = Math.round(from + (target - from) * eased);
      displayRef.current = val;
      setDisplay(val);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration]);

  return display;
}

// ─── StatCard ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, icon: Icon, iconColor, iconBg, loading, index = 0, spark,
}: {
  label: string; value: number; sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string; iconBg: string; loading?: boolean; index?: number;
  spark?: number[];
}) {
  // Hold the last known value while loading so it doesn't snap to 0
  const [animTarget, setAnimTarget] = useState(0);
  useEffect(() => {
    if (!loading) setAnimTarget(value);
  }, [value, loading]);

  const displayed = useCountUp(animTarget);

  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-border/60 bg-card p-3.5 sm:p-5 flex flex-col gap-1.5 sm:gap-2 animate-fade-in-up hover-lift"
      style={{ animationDelay: `${Math.min(index, 8) * 60}ms` }}
    >
      {/* Soft accent glow that appears on hover */}
      <div className={cn('pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100', iconBg)} />
      {/* 7-day trend behind the content */}
      {spark && !loading && (
        <span className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-8 sm:h-10 opacity-50', iconColor)}>
          <Sparkline data={spark} />
        </span>
      )}
      <div className="relative flex items-start justify-between gap-2">
        <p className="text-xs sm:text-sm text-muted-foreground font-medium leading-tight">{label}</p>
        <div className={cn('rounded-lg p-1.5 sm:p-2 shrink-0 transition-transform duration-200 ease-premium group-hover:scale-110 group-hover:-rotate-6', iconBg)}>
          <Icon className={cn('h-3.5 w-3.5 sm:h-4 sm:w-4', iconColor)} />
        </div>
      </div>
      {loading ? (
        <div className="h-8 sm:h-9 w-24 rounded-md bg-muted skeleton-shimmer" />
      ) : (
        <p className="relative text-2xl sm:text-3xl font-bold tracking-tight tabular-nums">{formatNum(displayed)}</p>
      )}
      {sub && <p className="relative text-[11px] sm:text-xs leading-tight text-muted-foreground">{sub}</p>}
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton({ className }: { className?: string }) {
  return <div className={cn('bg-muted animate-pulse rounded-lg', className)} />;
}

// ─── FilterDropdown (multi-select) ───────────────────────────────────────────

const STATUS_OPTION_META: Record<string, { dot: string; label: string }> = {
  PENDING:     { dot: 'bg-amber-400',   label: 'Pending' },
  APPROVED:    { dot: 'bg-emerald-500', label: 'Approved' },
  DISAPPROVED: { dot: 'bg-red-500',     label: 'Disapproved' },
};

function FilterDropdown({
  icon: Icon, iconColor, iconBg, accentColor, accentBg,
  label, value, onChange, options, statusMode, displayMap,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string; iconBg: string;
  accentColor: string; accentBg: string;
  label: string; value: string[];
  onChange: (v: string[]) => void;
  options: { value: string; label: string }[];
  statusMode?: boolean;
  displayMap?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, []);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const isActive = value.length > 0;

  const displayLabel =
    value.length === 0
      ? label
      : value.length === 1
      ? (statusMode
          ? (STATUS_OPTION_META[value[0]]?.label ?? value[0])
          : (displayMap?.[value[0]] ?? value[0]))
      : `${label} (${value.length})`;

  const toggle = (v: string) =>
    onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  const filteredOptions = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'h-10 flex items-center gap-2 px-3 rounded-xl border text-sm font-medium transition-all duration-150 whitespace-nowrap select-none',
          isActive
            ? `${accentBg} border-current/30 shadow-sm`
            : 'border-border/60 bg-card hover:border-border hover:bg-muted/30'
        )}
      >
        {/* Icon badge */}
        <span className={cn('flex items-center justify-center rounded-md w-6 h-6 shrink-0', isActive ? accentBg : iconBg)}>
          {statusMode && value.length === 1 && STATUS_OPTION_META[value[0]] ? (
            <span className={cn('h-2.5 w-2.5 rounded-full', STATUS_OPTION_META[value[0]].dot)} />
          ) : (
            <Icon className={cn('h-3.5 w-3.5', isActive ? accentColor : iconColor)} />
          )}
        </span>

        {/* Label */}
        <span className={cn('text-[13px]', isActive ? `${accentColor} font-semibold` : 'text-muted-foreground')}>
          {displayLabel}
        </span>

        {/* Count badge */}
        {value.length > 1 && (
          <span className={cn('text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center shrink-0 bg-primary text-primary-foreground')}>
            {value.length}
          </span>
        )}

        <ChevronDown className={cn(
          'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
          isActive ? accentColor : 'text-muted-foreground',
          open && 'rotate-180'
        )} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 bg-popover border border-border/80 rounded-xl shadow-2xl overflow-hidden min-w-[190px]">
          {/* Header */}
          <div className={cn('flex items-center justify-between px-3 py-2.5 border-b border-border/50', iconBg)}>
            <div className="flex items-center gap-2">
              <Icon className={cn('h-3.5 w-3.5', iconColor)} />
              <span className={cn('text-xs font-semibold', iconColor)}>{label}</span>
            </div>
            {isActive && (
              <button
                onClick={() => onChange([])}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Search */}
          <div className="px-2.5 py-2 border-b border-border/40">
            <div className="flex items-center gap-1.5 rounded-lg bg-muted/50 px-2.5 py-1.5">
              <Search className="h-3 w-3 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground min-w-0"
              />
              {query && (
                <button onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Options */}
          <div className="py-1 max-h-52 overflow-y-auto">
            {filteredOptions.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground text-center">No results</p>
            )}
            {filteredOptions.map((opt) => {
              const checked = value.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  onClick={() => toggle(opt.value)}
                  className={cn(
                    'w-full text-left px-3 py-2 text-[13px] transition-colors flex items-center gap-2.5',
                    checked ? `${accentBg} ${accentColor} font-medium` : 'hover:bg-muted/40 text-foreground'
                  )}
                >
                  {/* Checkbox */}
                  <span className={cn(
                    'h-[15px] w-[15px] rounded-[4px] border-[1.5px] flex items-center justify-center shrink-0 transition-all',
                    checked ? 'bg-primary border-primary' : 'border-border bg-background'
                  )}>
                    {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" strokeWidth={3} />}
                  </span>

                  {/* Status dot */}
                  {statusMode && STATUS_OPTION_META[opt.value] && (
                    <span className={cn('h-2 w-2 rounded-full shrink-0', STATUS_OPTION_META[opt.value].dot)} />
                  )}

                  <span className="truncate flex-1">{opt.label}</span>
                </button>
              );
            })}
          </div>

          {/* Footer */}
          {isActive && (
            <div className={cn('px-3 py-2 border-t border-border/50', accentBg)}>
              <p className={cn('text-[11px] font-semibold', accentColor)}>
                {value.length} selected
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CardSelector ────────────────────────────────────────────────────────────

function CardSelector({
  selectedExtras, onChange,
}: {
  selectedExtras: string[]; onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const toggle = (key: string) => {
    onChange(
      selectedExtras.includes(key)
        ? selectedExtras.filter((k) => k !== key)
        : [...selectedExtras, key]
    );
  };

  const defaultLabels: Record<string, string> = {
    totalLeads: 'Total Leads',
    assignedLeads: 'Assigned Leads',
    unassignedLeads: 'Unassigned Leads',
    connectedLeads: 'Connected Leads',
    untouchedLeads: 'Untouched Leads',
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/60 text-sm font-medium hover:bg-muted/50 transition-colors whitespace-nowrap"
      >
        <SlidersHorizontal className="h-4 w-4" />
        Customize Cards
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 bg-popover border border-border rounded-xl shadow-xl p-3 w-60">
          <p className="text-[11px] font-semibold text-muted-foreground tracking-wider mb-2 px-1">
            DEFAULT CARDS
          </p>
          <div className="space-y-0.5 mb-3">
            {DEFAULT_CARD_KEYS.map((key) => (
              <div key={key} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg opacity-60 text-sm">
                <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                {defaultLabels[key]}
              </div>
            ))}
          </div>
          <div className="border-t border-border/50 pt-2 mb-1">
            <p className="text-[11px] font-semibold text-muted-foreground tracking-wider mb-1.5 px-1">
              ADD MORE
            </p>
          </div>
          <div className="space-y-0.5">
            {EXTRA_CARD_OPTIONS.map(({ key, label }) => {
              const checked = selectedExtras.includes(key);
              return (
                <button
                  key={key}
                  onClick={() => toggle(key)}
                  className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-sm hover:bg-muted/60 transition-colors text-left"
                >
                  {checked
                    ? <CheckSquare className="h-4 w-4 text-primary shrink-0" />
                    : <Square className="h-4 w-4 text-muted-foreground shrink-0" />
                  }
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, labelFormatter }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-popover border border-border rounded-lg px-3 py-2 shadow-lg text-xs">
      <p className="text-muted-foreground mb-1">{labelFormatter ? labelFormatter(label) : label}</p>
      {payload.map((p: any) => (
        <p key={p.name} className="font-semibold" style={{ color: p.color }}>
          {p.name}: {formatNum(p.value)}
        </p>
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session } = useSession();
  const role = session?.user?.role;
  const name = session?.user?.name?.split(' ')[0] ?? 'there';

  // ── Date range ────────────────────────────────────────────────────────────
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('alltime');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [appliedCustom, setAppliedCustom] = useState({ from: '', to: '' });

  const dateRange = useMemo(() => {
    if (quickFilter === 'custom') return appliedCustom;
    return getQuickRange(quickFilter);
  }, [quickFilter, appliedCustom]);

  // ── Card selector ─────────────────────────────────────────────────────────
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);

  // ── Filters ───────────────────────────────────────────────────────────────
  const [pendingFilters, setPendingFilters] = useState<Filters>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS);

  const setFilter = (key: keyof Filters) => (value: string[]) =>
    setPendingFilters((prev) => ({ ...prev, [key]: value }));

  const applyFilters = () => setAppliedFilters({ ...pendingFilters });
  const resetFilters = () => {
    setPendingFilters(EMPTY_FILTERS);
    setAppliedFilters(EMPTY_FILTERS);
  };

  // ── Query params ──────────────────────────────────────────────────────────
  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    if (dateRange.from) p.set('from', dateRange.from);
    if (dateRange.to) p.set('to', dateRange.to);
    Object.entries(appliedFilters).forEach(([k, v]) => {
      if (Array.isArray(v) && v.length > 0) p.set(k, v.join(','));
    });
    return p.toString();
  }, [dateRange, appliedFilters]);

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats', queryParams],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard-stats?${queryParams}`);
      if (!res.ok) return {};
      return res.json();
    },
    enabled: !!session?.user?.id,
    staleTime: 2 * 60 * 1000,
  });

  const { data: filterOptions } = useQuery<FilterOptions>({
    queryKey: ['filter-options'],
    queryFn: () => fetch('/api/leads/filter-options').then((r) => r.json()),
    enabled: !!session?.user?.id,
    staleTime: 10 * 60 * 1000,
  });

  const { data: agentsList } = useQuery<AgentUser[]>({
    queryKey: ['agents-list'],
    queryFn: () => fetch('/api/users?role=COUNSELLING_AGENT').then(async (r) => { const d = await r.json(); return Array.isArray(d) ? d : []; }),
    enabled: role === 'SUPER_ADMIN' || role === 'REPORTS',
    staleTime: 10 * 60 * 1000,
  });

  const { data: feedbackOptions } = useQuery<FeedbackOption[]>({
    queryKey: ['feedback-options'],
    queryFn: () => fetch('/api/feedback-options').then((r) => r.json()),
    enabled: !!session?.user?.id,
    staleTime: 10 * 60 * 1000,
  });

  const s = stats ?? {};

  const periodLabel =
    quickFilter === 'alltime'
      ? 'All time'
      : quickFilter === 'custom' && appliedCustom.from
      ? `${appliedCustom.from} → ${appliedCustom.to}`
      : QUICK_FILTERS.find((f) => f.key === quickFilter)?.label ?? '';

  // ── Card definitions ──────────────────────────────────────────────────────
  // For all roles: connected % is relative to totalLeads (team scope for TL, own for Agent)
  const connectedDenom = s.totalLeads ?? 0;

  const ALL_CARD_DEFS: Record<string, { label: string; value: number; icon: React.ComponentType<{ className?: string }>; iconColor: string; iconBg: string; sub?: string; spark?: number[] }> = {
    totalLeads: {
      label: 'Total Leads', value: s.totalLeads ?? 0,
      icon: TrendingUp, iconColor: 'text-blue-500', iconBg: 'bg-blue-500/10',
      sub: periodLabel, spark: s.sparklines?.totalLeads,
    },
    assignedLeads: {
      label: 'Assigned Leads', value: s.assignedLeads ?? 0,
      icon: UserCheck, iconColor: 'text-emerald-500', iconBg: 'bg-emerald-500/10',
      sub: s.totalLeads
        ? `${Math.round(((s.assignedLeads ?? 0) / s.totalLeads) * 100)}% of total`
        : undefined,
      spark: s.sparklines?.assignedLeads,
    },
    unassignedLeads: {
      label: 'Unassigned Leads', value: s.unassignedLeads ?? 0,
      icon: UserX, iconColor: 'text-orange-500', iconBg: 'bg-orange-500/10',
      sub: 'Approved, awaiting assignment',
    },
    connectedLeads: {
      label: 'Connected Leads', value: s.connectedLeads ?? 0,
      icon: PhoneCall, iconColor: 'text-violet-500', iconBg: 'bg-violet-500/10',
      sub: connectedDenom
        ? `${Math.round(((s.connectedLeads ?? 0) / connectedDenom) * 100)}% contacted`
        : undefined,
      spark: s.sparklines?.connectedLeads,
    },
    untouchedLeads: {
      label: 'Untouched Leads', value: s.untouchedLeads ?? 0,
      icon: PhoneMissed, iconColor: 'text-red-500', iconBg: 'bg-red-500/10',
      sub: 'No feedback yet',
    },
    applications: {
      label: 'Applications', value: s.applications ?? 0,
      icon: GraduationCap, iconColor: 'text-teal-500', iconBg: 'bg-teal-500/10',
      sub: 'Application receipt uploaded',
    },
    admissions: {
      label: 'Admissions', value: s.admissions ?? 0,
      icon: Award, iconColor: 'text-rose-500', iconBg: 'bg-rose-500/10',
      sub: 'Admission receipt uploaded',
    },
    activeAgents: {
      label: 'Active Agents', value: s.activeAgents ?? 0,
      icon: Users, iconColor: 'text-indigo-500', iconBg: 'bg-indigo-500/10',
      sub: s.activeTLs ? `${s.activeTLs} Team Leads` : undefined,
    },
  };

  // COUNSELLING_AGENT has a fixed set of cards (no customize button).
  // COUNSELLING_TL uses the standard 5 defaults + the customize button for extras.
  // All other roles (SA, Reports, Ops) also use standard 5 defaults + customize button.
  const ROLE_DEFAULT_KEYS: Partial<Record<string, string[]>> = {
    COUNSELLING_AGENT: ['totalLeads', 'connectedLeads', 'untouchedLeads', 'applications', 'admissions'],
  };

  const hasRoleFixedCards = !!ROLE_DEFAULT_KEYS[role ?? ''];
  const defaultCardKeys = ROLE_DEFAULT_KEYS[role ?? ''] ?? DEFAULT_CARD_KEYS;

  const visibleCardKeys = hasRoleFixedCards
    ? defaultCardKeys
    : [...defaultCardKeys, ...selectedExtras.filter((k) => !defaultCardKeys.includes(k))];

  const visibleCards = visibleCardKeys
    .filter((k): k is keyof typeof ALL_CARD_DEFS => k in ALL_CARD_DEFS)
    .map((k) => ({ key: k, ...ALL_CARD_DEFS[k] }));

  const gridCols =
    visibleCards.length >= 7
      ? 'grid-cols-2 sm:grid-cols-4 lg:grid-cols-7'
      : visibleCards.length === 6
      ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6'
      : visibleCards.length === 5
      ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4';

  // ── Chart data ────────────────────────────────────────────────────────────
  const statusPieData = useMemo(() => {
    const approved = s.approvedLeads ?? 0;
    const pending = s.pendingLeads ?? 0;
    const disapproved = s.disapprovedLeads ?? 0;
    if (!approved && !pending && !disapproved) return [];
    return [
      { name: 'Approved', value: approved },
      { name: 'Pending', value: pending },
      { name: 'Disapproved', value: disapproved },
    ];
  }, [s.approvedLeads, s.pendingLeads, s.disapprovedLeads]);

  const leadsOverTime = s.leadsOverTime ?? [];
  const feedbackBreakdown = s.feedbackBreakdown ?? [];
  const topAgents = s.topAgents ?? [];

  const showAgentFilter = role === 'SUPER_ADMIN' || role === 'REPORTS';
  const showTopAgents = (role === 'SUPER_ADMIN' || role === 'COUNSELLING_TL') && topAgents.length > 0;
  const showFeedback = feedbackBreakdown.length > 0;

  const hasActiveFilters = Object.values(appliedFilters).some((v) => v.length > 0);

  return (
    <div className="flex flex-col gap-6 pb-6">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{getGreeting()}, {name}!</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {role?.replace(/_/g, ' ')}
            {hasActiveFilters && (
              <span className="ml-2 inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">
                Filters active
              </span>
            )}
          </p>
        </div>
        {!hasRoleFixedCards && (
          <CardSelector selectedExtras={selectedExtras} onChange={setSelectedExtras} />
        )}
      </div>

      {/* ── Date range chips ── */}
      <div className="flex flex-wrap items-center gap-2">
        <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
        {QUICK_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setQuickFilter(f.key)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-medium border transition-colors',
              quickFilter === f.key
                ? 'bg-primary/15 border-primary/40 text-primary'
                : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {quickFilter === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 pl-6">
          <input
            type="date" value={customFrom}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-muted-foreground text-sm">to</span>
          <input
            type="date" value={customTo}
            onChange={(e) => setCustomTo(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <button
            onClick={() => { if (customFrom && customTo) setAppliedCustom({ from: customFrom, to: customTo }); }}
            disabled={!customFrom || !customTo}
            className="h-8 px-4 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50 transition-opacity"
          >
            Apply
          </button>
        </div>
      )}

      {/* ── Stat Cards ── */}
      {/* On 2-col mobile, an odd last card stretches full width instead of sitting orphaned */}
      <div className={cn('grid gap-3 sm:gap-4 [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1', gridCols)}>
        {visibleCards.map((card, i) => (
          <StatCard
            key={card.key}
            label={card.label}
            value={card.value}
            icon={card.icon}
            iconColor={card.iconColor}
            iconBg={card.iconBg}
            sub={card.sub}
            spark={card.spark}
            loading={isLoading}
            index={i}
          />
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="rounded-2xl border border-border/60 bg-card">
        {/* Header bar */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/30 border-b border-border/50 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[11px] font-semibold text-muted-foreground tracking-wider">FILTERS</span>
            {Object.values(pendingFilters).some((v) => v.length > 0) && (
              <span className="text-[10px] font-bold bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 leading-none">
                {Object.values(pendingFilters).filter((v) => v.length > 0).length}
              </span>
            )}
          </div>
          {hasActiveFilters && (
            <span className="text-[11px] text-primary font-medium bg-primary/10 px-2 py-0.5 rounded-full">
              Filters active
            </span>
          )}
        </div>

        {/* Dropdowns */}
        <div className="p-3 flex flex-wrap gap-2 items-center">
          {/* Agent */}
          {showAgentFilter && Array.isArray(agentsList) && agentsList.length > 0 && (
            <FilterDropdown
              icon={User}
              iconColor="text-violet-600" iconBg="bg-violet-500/10"
              accentColor="text-violet-600" accentBg="bg-violet-500/10"
              label="Agent" value={pendingFilters.assignedToId}
              onChange={setFilter('assignedToId')}
              options={agentsList.map((a) => ({ value: a.id, label: a.name }))}
              displayMap={Object.fromEntries((agentsList ?? []).map((a) => [a.id, a.name]))}
            />
          )}

          {filterOptions && (
            <>
              <FilterDropdown
                icon={MapPin}
                iconColor="text-emerald-600" iconBg="bg-emerald-500/10"
                accentColor="text-emerald-600" accentBg="bg-emerald-500/10"
                label="City" value={pendingFilters.city}
                onChange={setFilter('city')}
                options={filterOptions.cities.map((c) => ({ value: c, label: c }))}
              />
              <FilterDropdown
                icon={Map}
                iconColor="text-teal-600" iconBg="bg-teal-500/10"
                accentColor="text-teal-600" accentBg="bg-teal-500/10"
                label="State" value={pendingFilters.state}
                onChange={setFilter('state')}
                options={filterOptions.states.map((s) => ({ value: s, label: s }))}
              />
              <FilterDropdown
                icon={BookOpen}
                iconColor="text-amber-600" iconBg="bg-amber-500/10"
                accentColor="text-amber-600" accentBg="bg-amber-500/10"
                label="Course" value={pendingFilters.course}
                onChange={setFilter('course')}
                options={filterOptions.courses.map((c) => ({ value: c, label: c }))}
              />
              <FilterDropdown
                icon={Tag}
                iconColor="text-rose-600" iconBg="bg-rose-500/10"
                accentColor="text-rose-600" accentBg="bg-rose-500/10"
                label="Lead Type" value={pendingFilters.leadType}
                onChange={setFilter('leadType')}
                options={filterOptions.leadTypes.map((t) => ({ value: t, label: t }))}
              />
              <FilterDropdown
                icon={Globe2}
                iconColor="text-cyan-600" iconBg="bg-cyan-500/10"
                accentColor="text-cyan-600" accentBg="bg-cyan-500/10"
                label="Lead Origin" value={pendingFilters.leadOrigin}
                onChange={setFilter('leadOrigin')}
                options={filterOptions.leadOrigins.map((o) => ({ value: o, label: o }))}
              />
              <FilterDropdown
                icon={Megaphone}
                iconColor="text-orange-600" iconBg="bg-orange-500/10"
                accentColor="text-orange-600" accentBg="bg-orange-500/10"
                label="Campaign" value={pendingFilters.campaign}
                onChange={setFilter('campaign')}
                options={filterOptions.campaigns.map((c) => ({ value: c, label: c }))}
              />
            </>
          )}

          {/* Feedback (last feedback of each lead) */}
          {Array.isArray(feedbackOptions) && feedbackOptions.length > 0 && (
            <FilterDropdown
              icon={MessageSquare}
              iconColor="text-fuchsia-600" iconBg="bg-fuchsia-500/10"
              accentColor="text-fuchsia-600" accentBg="bg-fuchsia-500/10"
              label="Feedback" value={pendingFilters.feedback}
              onChange={setFilter('feedback')}
              options={feedbackOptions.map((o) => ({ value: o.id, label: o.label }))}
              displayMap={Object.fromEntries((feedbackOptions ?? []).map((o) => [o.id, o.label]))}
            />
          )}

          {/* Divider */}
          <div className="h-7 w-px bg-border/60 mx-1 hidden sm:block" />

          <button
            onClick={applyFilters}
            className="h-10 px-5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold flex items-center gap-2 hover:bg-primary/90 active:scale-95 transition-all shadow-sm"
          >
            <Search className="h-3.5 w-3.5" />
            Search
          </button>
          <button
            onClick={resetFilters}
            className="h-10 px-4 rounded-xl border border-border/60 text-sm font-medium flex items-center gap-2 hover:bg-muted/50 active:scale-95 transition-all text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      {/* ── Top charts row: Leads Over Time + Status Pie ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Leads Over Time */}
        <div className="lg:col-span-2 rounded-xl border border-border/60 bg-card p-5">
          <h2 className="text-sm font-semibold mb-1">Leads Over Time</h2>
          <p className="text-xs text-muted-foreground mb-4">{periodLabel}</p>
          {isLoading ? (
            <Skeleton className="h-52" />
          ) : leadsOverTime.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
              No data for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={210}>
              <AreaChart data={leadsOverTime} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" />
                <XAxis
                  dataKey="date" tick={{ fontSize: 11 }}
                  tickFormatter={fmtChartDate}
                  stroke="currentColor" className="text-muted-foreground"
                  tickLine={false} axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="currentColor" className="text-muted-foreground"
                  tickLine={false} axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<ChartTooltip labelFormatter={fmtChartDate} />} />
                <Area
                  type="monotone" dataKey="count" name="Leads"
                  stroke="#6366f1" fill="url(#leadsGrad)"
                  strokeWidth={2} dot={false}
                  activeDot={{ r: 4, fill: '#6366f1' }}
                  animationDuration={900} animationEasing="ease-out"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Status Breakdown Pie */}
        <div className="rounded-xl border border-border/60 bg-card p-5">
          <h2 className="text-sm font-semibold mb-1">Status Breakdown</h2>
          <p className="text-xs text-muted-foreground mb-4">Lead distribution</p>
          {isLoading ? (
            <Skeleton className="h-52" />
          ) : statusPieData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-sm text-muted-foreground">
              No data
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie
                    data={statusPieData}
                    cx="50%" cy="50%"
                    innerRadius={48} outerRadius={72}
                    dataKey="value"
                    paddingAngle={3}
                    animationBegin={0} animationDuration={800}
                  >
                    {statusPieData.map((_, i) => (
                      <Cell key={i} fill={STATUS_PIE_COLORS[i % STATUS_PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 justify-center">
                {statusPieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: STATUS_PIE_COLORS[i] }}
                    />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-semibold tabular-nums">{formatNum(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom charts: Feedback + Top Performers ── */}
      {(showFeedback || showTopAgents) && (
        <div className={cn('grid gap-4', showFeedback && showTopAgents ? 'lg:grid-cols-2' : '')}>
          {/* Feedback Breakdown */}
          {showFeedback && (
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <h2 className="text-sm font-semibold mb-1">Feedback Breakdown</h2>
              <p className="text-xs text-muted-foreground mb-4">Top feedback categories</p>
              {isLoading ? (
                <Skeleton className="h-52" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={feedbackBreakdown}
                    layout="vertical"
                    margin={{ top: 0, right: 16, left: 90, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="currentColor" className="text-border/40" />
                    <XAxis
                      type="number" tick={{ fontSize: 11 }}
                      stroke="currentColor" className="text-muted-foreground"
                      tickLine={false} axisLine={false} allowDecimals={false}
                    />
                    <YAxis
                      type="category" dataKey="label" tick={{ fontSize: 11 }}
                      stroke="currentColor" className="text-muted-foreground"
                      tickLine={false} axisLine={false} width={85}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name="Count" radius={[0, 4, 4, 0]} animationDuration={800}>
                      {feedbackBreakdown.map((_, i) => (
                        <Cell key={i} fill={FEEDBACK_COLORS[i % FEEDBACK_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          )}

          {/* Top Performers */}
          {showTopAgents && (
            <div className="rounded-xl border border-border/60 bg-card p-5">
              <h2 className="text-sm font-semibold mb-1">Top Performers</h2>
              <p className="text-xs text-muted-foreground mb-4">Agents by call count{periodLabel ? ` · ${periodLabel}` : ''}</p>
              {isLoading ? (
                <Skeleton className="h-52" />
              ) : (
                <Leaderboard agents={topAgents} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
