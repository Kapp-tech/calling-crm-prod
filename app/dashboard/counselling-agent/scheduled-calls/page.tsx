'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  CalendarClock, Phone, Clock, CheckCircle2, XCircle,
  AlertCircle, Loader2, List, Calendar, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { LeadDetailDrawer } from '@/components/leads/lead-detail-drawer';
import { PaginationBar } from '@/components/shared/pagination-bar';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string; name: string; email: string; phone: string;
  city?: string | null; state?: string | null; course?: string | null;
  college?: string | null; campaign?: string | null;
  leadType?: string | null; leadOrigin?: string | null; leadZone?: string | null;
  status: string; createdAt: string; updatedAt: string;
  assignedTo?: { id: string; name: string } | null;
  feedbacks: { followUpNumber: number; feedbackOption?: { label: string } | null }[];
  _count: { feedbacks: number };
}

interface ScheduledCall {
  id: string;
  scheduledAt: string;
  note?: string | null;
  status: 'PENDING' | 'DONE' | 'CANCELLED';
  agent: { id: string; name: string };
  lead: Lead;
}

interface ApiResponse {
  calls: ScheduledCall[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

type StatusFilter = 'PENDING' | 'DONE' | 'CANCELLED' | 'all';
type ViewMode = 'list' | 'calendar';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatScheduled(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function getScheduleState(scheduledAt: string, status: 'PENDING' | 'DONE' | 'CANCELLED') {
  if (status !== 'PENDING') return status;
  const now = new Date();
  const scheduled = new Date(scheduledAt);
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  if (scheduled < now) return 'OVERDUE';
  if (scheduled < endOfToday) return 'TODAY';
  return 'UPCOMING';
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-border/40 animate-pulse">
          {[16, 20, 28, 32, 40, 20, 16, 20, 20, 18].map((w, j) => (
            <td key={j} className="px-3 py-2.5">
              <div className={`h-3 w-${w} rounded bg-muted`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function SchedulePill({ scheduledAt, status }: { scheduledAt: string; status: 'PENDING' | 'DONE' | 'CANCELLED' }) {
  const state = getScheduleState(scheduledAt, status);
  if (state === 'OVERDUE') return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.5 text-[10px] font-medium text-red-500">
      <AlertCircle className="h-2.5 w-2.5" /> Overdue
    </span>
  );
  if (state === 'TODAY') return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-medium text-amber-500">
      <Clock className="h-2.5 w-2.5" /> Today
    </span>
  );
  if (state === 'UPCOMING') return (
    <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 text-[10px] font-medium text-blue-400">
      <CalendarClock className="h-2.5 w-2.5" /> Upcoming
    </span>
  );
  if (state === 'DONE') return (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 border border-green-500/30 px-2 py-0.5 text-[10px] font-medium text-green-500">
      <CheckCircle2 className="h-2.5 w-2.5" /> Done
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <XCircle className="h-2.5 w-2.5" /> Cancelled
    </span>
  );
}

// ─── Calendar View ────────────────────────────────────────────────────────────

function CalendarView({
  calls,
  calendarMonth,
  onMonthChange,
  onLeadClick,
  isLoading,
  session,
}: {
  calls: ScheduledCall[];
  calendarMonth: Date;
  onMonthChange: (d: Date) => void;
  onLeadClick: (id: string) => void;
  isLoading: boolean;
  session: { user: { role: string } } | null;
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const year  = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  // First day of month and how many days
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // Map ISO date string YYYY-MM-DD → calls on that day
  const callsByDay = useMemo(() => {
    const map: Record<string, ScheduledCall[]> = {};
    for (const call of calls) {
      const d = new Date(call.scheduledAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(call);
    }
    return map;
  }, [calls]);

  const prevMonth = () => onMonthChange(new Date(year, month - 1, 1));
  const nextMonth = () => onMonthChange(new Date(year, month + 1, 1));
  const goToday   = () => onMonthChange(new Date(today.getFullYear(), today.getMonth(), 1));

  const monthLabel = calendarMonth.toLocaleString('en-IN', { month: 'long', year: 'numeric' });

  // Build grid cells: leading empty + day cells
  const cells: Array<{ day: number | null; dateKey: string | null }> = [];
  for (let i = 0; i < firstDay; i++) cells.push({ day: null, dateKey: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    cells.push({ day: d, dateKey });
  }
  // Fill trailing empty cells to complete the last row
  while (cells.length % 7 !== 0) cells.push({ day: null, dateKey: null });

  return (
    <div className="flex flex-col gap-3 h-full">
      {/* Month navigation */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold min-w-[160px] text-center">{monthLabel}</span>
          <button
            onClick={nextMonth}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={goToday}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          Today
        </button>
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto rounded-lg border border-border/60">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="min-w-[700px]">
            {/* Week day headers */}
            <div className="grid grid-cols-7 border-b border-border/60 bg-muted">
              {WEEK_DAYS.map((wd) => (
                <div key={wd} className="py-2 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {wd}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid grid-cols-7">
              {cells.map((cell, idx) => {
                if (!cell.day || !cell.dateKey) {
                  return (
                    <div key={`empty-${idx}`} className="min-h-[110px] border-b border-r border-border/40 bg-muted/20 last:border-r-0" />
                  );
                }
                const cellDate = new Date(year, month, cell.day);
                const isToday = cellDate.getTime() === today.getTime();
                const dayCalls = callsByDay[cell.dateKey] ?? [];

                return (
                  <div
                    key={cell.dateKey}
                    className={cn(
                      'min-h-[110px] border-b border-r border-border/40 p-1.5 last:border-r-0',
                      isToday ? 'bg-primary/5' : 'bg-background hover:bg-muted/20 transition-colors'
                    )}
                  >
                    {/* Day number */}
                    <div className="mb-1 flex items-center justify-between">
                      <span className={cn(
                        'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold',
                        isToday ? 'bg-primary text-primary-foreground' : 'text-foreground'
                      )}>
                        {cell.day}
                      </span>
                      {dayCalls.length > 0 && (
                        <span className="text-[9px] font-bold text-muted-foreground">{dayCalls.length}</span>
                      )}
                    </div>

                    {/* Call chips — show up to 3, then "+N more" */}
                    <div className="space-y-0.5">
                      {dayCalls.slice(0, 3).map((call) => {
                        const state = getScheduleState(call.scheduledAt, call.status);
                        return (
                          <button
                            key={call.id}
                            onClick={() => onLeadClick(call.lead.id)}
                            className={cn(
                              'w-full text-left rounded px-1.5 py-0.5 text-[10px] font-medium leading-tight truncate transition-opacity hover:opacity-80',
                              state === 'OVERDUE'  ? 'bg-red-500/15 text-red-600 dark:text-red-400' :
                              state === 'TODAY'    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' :
                              state === 'DONE'     ? 'bg-green-500/10 text-green-700 dark:text-green-400' :
                              state === 'CANCELLED'? 'bg-muted text-muted-foreground line-through' :
                                                     'bg-blue-500/10 text-blue-700 dark:text-blue-400'
                            )}
                            title={`${call.lead.name} · ${formatTime(call.scheduledAt)}${call.note ? ` · ${call.note}` : ''}`}
                          >
                            {formatTime(call.scheduledAt)} · {call.lead.name}
                            {session?.user?.role !== 'COUNSELLING_AGENT' && (
                              <span className="opacity-60"> ({call.agent.name})</span>
                            )}
                          </button>
                        );
                      })}
                      {dayCalls.length > 3 && (
                        <p className="pl-1 text-[9px] font-semibold text-muted-foreground">
                          +{dayCalls.length - 3} more
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 shrink-0 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-red-500/30" /> Overdue</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-amber-500/30" /> Today</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-blue-500/20" /> Upcoming</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-green-500/20" /> Done</span>
        <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded bg-muted" /> Cancelled</span>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScheduledCallsPage() {
  const { data: session } = useSession();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('PENDING');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  // Calendar state
  const now = new Date();
  const [calendarMonth, setCalendarMonth] = useState(new Date(now.getFullYear(), now.getMonth(), 1));

  const TABS: { label: string; value: StatusFilter }[] = [
    { label: 'Pending',   value: 'PENDING' },
    { label: 'Done',      value: 'DONE' },
    { label: 'Cancelled', value: 'CANCELLED' },
    { label: 'All',       value: 'all' },
  ];

  // Calendar fetches the whole month with status=all, no pagination
  const calendarFrom = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).toISOString();
  const calendarTo   = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();

  const { data: calendarData, isLoading: calendarLoading, isFetching: calendarFetching } = useQuery<ApiResponse>({
    queryKey: ['scheduled-calls-calendar', calendarMonth.toISOString()],
    queryFn: () => {
      const p = new URLSearchParams({ status: 'all', limit: '500', from: calendarFrom, to: calendarTo });
      return fetch(`/api/leads/scheduled-calls?${p}`).then((r) => r.json());
    },
    enabled: !!session?.user?.id && viewMode === 'calendar',
    staleTime: 60_000,
  });

  const { data, isLoading, isFetching } = useQuery<ApiResponse>({
    queryKey: ['scheduled-calls', statusFilter, page, limit],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: String(limit) });
      p.set('status', statusFilter !== 'all' ? statusFilter : 'all');
      return fetch(`/api/leads/scheduled-calls?${p}`).then((r) => r.json());
    },
    enabled: !!session?.user?.id && viewMode === 'list',
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const calls = data?.calls ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const overdue  = calls.filter((c) => getScheduleState(c.scheduledAt, c.status) === 'OVERDUE').length;
  const today    = calls.filter((c) => getScheduleState(c.scheduledAt, c.status) === 'TODAY').length;
  const upcoming = calls.filter((c) => getScheduleState(c.scheduledAt, c.status) === 'UPCOMING').length;

  function handleTabChange(val: StatusFilter) {
    setStatusFilter(val);
    setPage(1);
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Top bar: summary strip + view toggle */}
      <div className="flex items-start justify-between gap-4 flex-wrap shrink-0">
        {/* Summary strip — only in list/pending mode */}
        {viewMode === 'list' && statusFilter === 'PENDING' && !isLoading && (
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
              <span className="font-bold text-red-500">{overdue}</span>
              <span className="text-sm text-red-500/80">Overdue</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <Clock className="h-4 w-4 text-amber-500 shrink-0" />
              <span className="font-bold text-amber-600">{today}</span>
              <span className="text-sm text-amber-600/80">Today</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-bold">{upcoming}</span>
              <span className="text-sm text-muted-foreground">Upcoming</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="font-bold">{total}</span>
            </div>
          </div>
        )}

        {/* View toggle */}
        <div className="ml-auto flex items-center gap-0 rounded-lg border border-border overflow-hidden shrink-0">
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors',
              viewMode === 'list'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <List className="h-3.5 w-3.5" /> List
          </button>
          <button
            onClick={() => setViewMode('calendar')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-l border-border',
              viewMode === 'calendar'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <Calendar className="h-3.5 w-3.5" /> Calendar
          </button>
        </div>
      </div>

      {/* ── CALENDAR VIEW ───────────────────────────────────────────────── */}
      {viewMode === 'calendar' && (
        <CalendarView
          calls={calendarData?.calls ?? []}
          calendarMonth={calendarMonth}
          onMonthChange={setCalendarMonth}
          onLeadClick={setSelectedLeadId}
          isLoading={calendarLoading || calendarFetching}
          session={session}
        />
      )}

      {/* ── LIST VIEW ───────────────────────────────────────────────────── */}
      {viewMode === 'list' && (
        <>
          {/* Status filter tabs */}
          <div className="flex items-center gap-1 border-b border-border/60 pb-0 shrink-0">
            {TABS.map((tab) => (
              <button
                key={tab.value + tab.label}
                onClick={() => handleTabChange(tab.value)}
                className={cn(
                  'px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                  statusFilter === tab.value
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
            {isFetching && !isLoading && (
              <Loader2 className="ml-2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto rounded-lg border border-border/60">
            <table className="w-full min-w-[900px] text-xs">
              <thead className="sticky top-0 z-10 bg-muted border-b border-border/60">
                <tr>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Lead ID</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Name</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Phone</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Email</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">City</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Course</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Scheduled At</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">State</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Follow-ups</th>
                  <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Last Feedback</th>
                  {session?.user?.role !== 'COUNSELLING_AGENT' && (
                    <th className="px-3 py-2.5 text-left font-semibold text-muted-foreground whitespace-nowrap">Agent</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <SkeletonRows />
                ) : calls.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-16 text-center text-muted-foreground">
                      <CalendarClock className="mx-auto mb-2 h-8 w-8 opacity-30" />
                      <p className="text-sm">No scheduled calls found</p>
                    </td>
                  </tr>
                ) : (
                  calls.map((call) => {
                    const lead = call.lead;
                    const state = getScheduleState(call.scheduledAt, call.status);
                    const isOverdue = state === 'OVERDUE';
                    const isToday   = state === 'TODAY';
                    return (
                      <tr
                        key={call.id}
                        onClick={() => setSelectedLeadId(lead.id)}
                        className={cn(
                          'group border-b border-border/40 cursor-pointer transition-colors',
                          isOverdue ? 'hover:bg-red-500/5' : isToday ? 'hover:bg-amber-500/5' : 'hover:bg-muted/50'
                        )}
                      >
                        <td className="px-3 py-2.5 whitespace-nowrap font-mono text-[10px] text-muted-foreground">
                          {lead.id}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="font-medium text-foreground group-hover:text-primary transition-colors">
                            {lead.name}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <a
                            href={`tel:${lead.phone}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 text-muted-foreground hover:text-primary transition-colors"
                          >
                            <Phone className="h-2.5 w-2.5 shrink-0" />
                            {lead.phone}
                          </a>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground max-w-[180px] truncate">
                          {lead.email}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                          {lead.city ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                          {lead.course ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <div className="flex flex-col gap-0.5">
                            <span className={cn(
                              'text-xs',
                              isOverdue ? 'text-red-500 font-medium' : isToday ? 'text-amber-600 font-medium' : 'text-foreground'
                            )}>
                              {formatScheduled(call.scheduledAt)}
                            </span>
                            {call.note && (
                              <span className="text-[10px] text-muted-foreground italic truncate max-w-[160px]">
                                {call.note}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <SchedulePill scheduledAt={call.scheduledAt} status={call.status} />
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-center">
                          <span className={cn(
                            'inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                            lead._count.feedbacks > 0
                              ? 'bg-primary/15 text-primary'
                              : 'bg-muted text-muted-foreground'
                          )}>
                            {lead._count.feedbacks}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {lead.feedbacks[0]?.feedbackOption?.label ? (
                            <span className="rounded-full bg-secondary border border-border px-2 py-0.5 text-[10px]">
                              {lead.feedbacks[0].feedbackOption.label}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">New</span>
                          )}
                        </td>
                        {session?.user?.role !== 'COUNSELLING_AGENT' && (
                          <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                            {call.agent.name}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {!isLoading && (
            <PaginationBar
              page={page}
              totalPages={totalPages}
              total={total}
              limit={limit}
              onPageChange={(p) => setPage(p)}
              onLimitChange={(l) => { setLimit(l); setPage(1); }}
              disabled={isFetching}
              className="shrink-0"
            />
          )}
        </>
      )}

      {/* Lead detail drawer */}
      {selectedLeadId && (
        <LeadDetailDrawer
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
        />
      )}
    </div>
  );
}
