'use client';

import { useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart3, ChevronDown, ChevronUp, Download, Filter,
  Loader2, RefreshCw, Search, Users, MapPin, Building2,
  Phone, TrendingUp, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Label } from '@/components/ui/label';

// ─── Types ────────────────────────────────────────────────────────────────────

type Dim = 'agent' | 'feedback' | 'state' | 'city' | 'college' | 'campaign' | 'leadType';

interface Filters {
  from: string; to: string;
  teamId: string; agentId: string; workType: string;
  feedbackOptionId: string;
  state: string; city: string; college: string;
  campaign: string; leadType: string;
}

interface AnalyticsRow {
  agentId?: string; agentName?: string;
  feedbackId?: string; feedbackLabel?: string;
  state?: string; city?: string; college?: string;
  campaign?: string; leadType?: string;
  callCount: number; uniqueLeads: number;
}

interface Summary {
  totalCalls: number; uniqueLeads: number; activeAgents: number;
  uniqueStates: number; uniqueCities: number; uniqueColleges: number;
}

interface AnalyticsResponse { summary: Summary; rows: AnalyticsRow[]; dims: Dim[] }

const EMPTY_FILTERS: Filters = {
  from: '', to: '', teamId: '', agentId: '', workType: '',
  feedbackOptionId: '', state: '', city: '', college: '',
  campaign: '', leadType: '',
};

const DIM_LABELS: Record<Dim, string> = {
  agent: 'Agent', feedback: 'Feedback', state: 'State',
  city: 'City', college: 'College', campaign: 'Campaign', leadType: 'Lead Type',
};

const ALL_DIMS: Dim[] = ['agent', 'feedback', 'state', 'city', 'college', 'campaign', 'leadType'];

// ─── CSV export ───────────────────────────────────────────────────────────────

function esc(v: string | number | undefined | null): string {
  const s = String(v ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCSV(dims: Dim[], rows: AnalyticsRow[]) {
  const colDefs = getDimColDefs(dims);
  const headers = [...colDefs.map((c) => c.label), 'Calls', 'Unique Leads'];
  const csvRows = rows.map((r) => [
    ...colDefs.map((c) => esc(c.value(r))),
    esc(r.callCount),
    esc(r.uniqueLeads),
  ].join(','));
  const csv = [headers.join(','), ...csvRows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `analytics_${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Column definitions per dim ───────────────────────────────────────────────

function getDimColDefs(dims: Dim[]): { key: string; label: string; value: (r: AnalyticsRow) => string | number | undefined }[] {
  const map: Record<Dim, { key: string; label: string; value: (r: AnalyticsRow) => string | number | undefined }> = {
    agent:    { key: 'agentName',     label: 'Agent',     value: (r) => r.agentName },
    feedback: { key: 'feedbackLabel', label: 'Feedback',  value: (r) => r.feedbackLabel },
    state:    { key: 'state',         label: 'State',     value: (r) => r.state },
    city:     { key: 'city',          label: 'City',      value: (r) => r.city },
    college:  { key: 'college',       label: 'College',   value: (r) => r.college },
    campaign: { key: 'campaign',      label: 'Campaign',  value: (r) => r.campaign },
    leadType: { key: 'leadType',      label: 'Lead Type', value: (r) => r.leadType },
  };
  return dims.map((d) => map[d]);
}

// ─── Summary card ─────────────────────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }: {
  icon: React.ElementType; label: string; value: number; color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${color}`}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-2xl font-bold leading-none">{value.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { data: session } = useSession();
  const isTL = session?.user?.role === 'COUNSELLING_TL';

  // Applied state (drives the query)
  const [applied, setApplied]   = useState<Filters>(EMPTY_FILTERS);
  const [dims, setDims]         = useState<Dim[]>(['agent', 'feedback']);

  // Pending state (what the user is editing)
  const [pending, setPending]   = useState<Filters>(EMPTY_FILTERS);
  const [pendingDims, setPendingDims] = useState<Dim[]>(['agent', 'feedback']);

  // UI state
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [tableSearch, setTableSearch] = useState('');
  const [sort, setSort] = useState<{ col: string; dir: 'asc' | 'desc' }>({ col: 'callCount', dir: 'desc' });

  // ── Filter option lists ────────────────────────────────────────────────────

  const { data: teamsData } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['analytics-teams'],
    queryFn: () => fetch('/api/teams').then((r) => r.json()).then((d) => (Array.isArray(d) ? d : d.teams ?? [])),
    enabled: !isTL,
  });

  const { data: agentsData } = useQuery<{ id: string; name: string; workType: string }[]>({
    queryKey: ['analytics-agents'],
    queryFn: () => fetch('/api/users?role=COUNSELLING_AGENT').then((r) => r.json())
      .then((d) => Array.isArray(d) ? d : []),
  });

  const { data: feedbackOpts } = useQuery<{ id: string; label: string }[]>({
    queryKey: ['analytics-feedback-opts'],
    queryFn: () => fetch('/api/feedback-options').then((r) => r.json())
      .then((d) => Array.isArray(d) ? d : []),
  });

  const { data: filterOptions } = useQuery<{
    states: string[]; cities: string[]; colleges: string[]; campaigns: string[]; leadTypes: string[];
  }>({
    queryKey: ['analytics-lead-filter-opts'],
    queryFn: () => fetch('/api/leads/filter-options').then((r) => r.json()).then((d) => ({
      states:    d.states    ?? [],
      cities:    d.cities    ?? [],
      colleges:  d.colleges  ?? [],
      campaigns: d.campaigns ?? [],
      leadTypes: d.leadTypes ?? [],
    })),
  });

  // ── Main analytics query ──────────────────────────────────────────────────

  const queryParams = useMemo(() => {
    const p = new URLSearchParams({ groupBy: dims.join(',') });
    if (applied.from)            p.set('from', applied.from);
    if (applied.to)              p.set('to', applied.to);
    if (applied.teamId)          p.set('teamId', applied.teamId);
    if (applied.agentId)         p.set('agentId', applied.agentId);
    if (applied.workType)        p.set('workType', applied.workType);
    if (applied.feedbackOptionId) p.set('feedbackOptionId', applied.feedbackOptionId);
    if (applied.state)           p.set('state', applied.state);
    if (applied.city)            p.set('city', applied.city);
    if (applied.college)         p.set('college', applied.college);
    if (applied.campaign)        p.set('campaign', applied.campaign);
    if (applied.leadType)        p.set('leadType', applied.leadType);
    return p.toString();
  }, [applied, dims]);

  const { data, isLoading, refetch, isFetching } = useQuery<AnalyticsResponse>({
    queryKey: ['reports-analytics', queryParams],
    queryFn: () => fetch(`/api/reports/analytics?${queryParams}`).then((r) => r.json()),
    enabled: !!session?.user?.id,
  });

  // ── Apply / reset ─────────────────────────────────────────────────────────

  const handleApply = () => {
    setApplied(pending);
    setDims(pendingDims);
  };

  const handleReset = () => {
    setPending(EMPTY_FILTERS);
    setPendingDims(['agent', 'feedback']);
    setApplied(EMPTY_FILTERS);
    setDims(['agent', 'feedback']);
  };

  const toggleDim = (d: Dim) => {
    setPendingDims((prev) =>
      prev.includes(d)
        ? prev.length === 1 ? prev : prev.filter((x) => x !== d)
        : [...prev, d]
    );
  };

  const activeFilterCount = Object.values(applied).filter(Boolean).length;

  // ── Table logic ───────────────────────────────────────────────────────────

  const colDefs = getDimColDefs(dims);

  const filteredRows = useMemo(() => {
    const rows = data?.rows ?? [];
    const q = tableSearch.toLowerCase();
    const filtered = q
      ? rows.filter((r) =>
          colDefs.some((c) => String(c.value(r) ?? '').toLowerCase().includes(q))
        )
      : rows;

    return [...filtered].sort((a, b) => {
      const av = sort.col === 'callCount' ? a.callCount
               : sort.col === 'uniqueLeads' ? a.uniqueLeads
               : String(colDefs.find((c) => c.key === sort.col)?.value(a) ?? '');
      const bv = sort.col === 'callCount' ? b.callCount
               : sort.col === 'uniqueLeads' ? b.uniqueLeads
               : String(colDefs.find((c) => c.key === sort.col)?.value(b) ?? '');
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data?.rows, tableSearch, sort, colDefs]);

  const handleSort = (col: string) => {
    setSort((prev) => prev.col === col ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sort.col !== col) return <ChevronDown className="h-3 w-3 opacity-30 ml-1 inline" />;
    return sort.dir === 'asc'
      ? <ChevronUp className="h-3 w-3 ml-1 inline text-primary" />
      : <ChevronDown className="h-3 w-3 ml-1 inline text-primary" />;
  };

  const summary = data?.summary;

  return (
    <div className="space-y-5">

      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Slice and dice call activity by agent, feedback, location, college, campaign and more.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {data && data.rows.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => exportCSV(dims, filteredRows)}>
              <Download className="mr-2 h-3.5 w-3.5" />
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {/* ── Filters card ──────────────────────────────────────────────────── */}
      <Card>
        <button
          className="w-full flex items-center justify-between px-5 py-3.5 text-left"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <span className="flex items-center gap-2 font-medium text-sm">
            <Filter className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="text-xs px-1.5 py-0">{activeFilterCount} active</Badge>
            )}
          </span>
          {filtersOpen
            ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {filtersOpen && (
          <CardContent className="pt-0 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">

              {/* Date range */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">From date</Label>
                <Input
                  type="date"
                  value={pending.from}
                  onChange={(e) => setPending({ ...pending, from: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To date</Label>
                <Input
                  type="date"
                  value={pending.to}
                  onChange={(e) => setPending({ ...pending, to: e.target.value })}
                  className="h-8 text-sm"
                />
              </div>

              {/* Team */}
              {!isTL && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Team</Label>
                  <Select value={pending.teamId || '__all__'} onValueChange={(v) => setPending({ ...pending, teamId: v === '__all__' ? '' : v })}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All teams" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">All teams</SelectItem>
                      {(teamsData ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Type */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select value={pending.workType || '__all__'} onValueChange={(v) => setPending({ ...pending, workType: v === '__all__' ? '' : v, agentId: '' })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All types" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All types</SelectItem>
                    <SelectItem value="WFH">WFH</SelectItem>
                    <SelectItem value="WFO">WFO</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Agent */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Agent</Label>
                <Select value={pending.agentId || '__all__'} onValueChange={(v) => setPending({ ...pending, agentId: v === '__all__' ? '' : v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All agents" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All agents</SelectItem>
                    {(agentsData ?? [])
                      .filter((a) => !pending.workType || a.workType === pending.workType)
                      .map((a) => (
                        <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Feedback */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Feedback type</Label>
                <Select value={pending.feedbackOptionId || '__all__'} onValueChange={(v) => setPending({ ...pending, feedbackOptionId: v === '__all__' ? '' : v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All feedback" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All feedback</SelectItem>
                    {(feedbackOpts ?? []).map((f) => (
                      <SelectItem key={f.id} value={f.id}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* State */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">State</Label>
                <Select value={pending.state || '__all__'} onValueChange={(v) => setPending({ ...pending, state: v === '__all__' ? '' : v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All states" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All states</SelectItem>
                    {(filterOptions?.states ?? []).map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* City */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">City</Label>
                <Select value={pending.city || '__all__'} onValueChange={(v) => setPending({ ...pending, city: v === '__all__' ? '' : v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All cities" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All cities</SelectItem>
                    {(filterOptions?.cities ?? []).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* College */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">College</Label>
                <Select value={pending.college || '__all__'} onValueChange={(v) => setPending({ ...pending, college: v === '__all__' ? '' : v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All colleges" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All colleges</SelectItem>
                    {(filterOptions?.colleges ?? []).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Campaign */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Campaign</Label>
                <Select value={pending.campaign || '__all__'} onValueChange={(v) => setPending({ ...pending, campaign: v === '__all__' ? '' : v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All campaigns" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All campaigns</SelectItem>
                    {(filterOptions?.campaigns ?? []).map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Lead Type */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Lead type</Label>
                <Select value={pending.leadType || '__all__'} onValueChange={(v) => setPending({ ...pending, leadType: v === '__all__' ? '' : v })}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="All types" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All types</SelectItem>
                    {(filterOptions?.leadTypes ?? []).map((lt) => (
                      <SelectItem key={lt} value={lt}>{lt}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleApply}>Apply Filters</Button>
              <Button size="sm" variant="outline" onClick={handleReset}>
                <X className="mr-1.5 h-3.5 w-3.5" /> Clear All
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── Group By ──────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground shrink-0">Group by:</span>
        {ALL_DIMS.map((d) => {
          const active = pendingDims.includes(d);
          return (
            <button
              key={d}
              onClick={() => toggleDim(d)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors
                ${active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                }`}
            >
              {DIM_LABELS[d]}
            </button>
          );
        })}
        {JSON.stringify(pendingDims) !== JSON.stringify(dims) && (
          <Button size="sm" className="h-7 text-xs px-3 ml-2" onClick={handleApply}>
            Apply
          </Button>
        )}
      </div>

      {/* ── Summary cards ─────────────────────────────────────────────────── */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard icon={Phone}      label="Total Calls"     value={summary.totalCalls}     color="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" />
          <StatCard icon={Users}      label="Unique Leads"    value={summary.uniqueLeads}    color="bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300" />
          <StatCard icon={TrendingUp} label="Active Agents"   value={summary.activeAgents}   color="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" />
          <StatCard icon={MapPin}     label="States Covered"  value={summary.uniqueStates}   color="bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" />
          <StatCard icon={MapPin}     label="Cities Covered"  value={summary.uniqueCities}   color="bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300" />
          <StatCard icon={Building2}  label="Colleges Covered" value={summary.uniqueColleges} color="bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300" />
        </div>
      )}

      {/* ── Results table ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base">
              Results
              {filteredRows.length > 0 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  {filteredRows.length.toLocaleString()} {filteredRows.length === 1 ? 'row' : 'rows'}
                </span>
              )}
            </CardTitle>
            <div className="relative w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search results…"
                className="pl-8 h-8 text-sm"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span className="text-sm">Loading analytics…</span>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <BarChart3 className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm font-medium text-muted-foreground">
                {tableSearch ? 'No rows match your search.' : 'No data found for the selected filters.'}
              </p>
              {!tableSearch && (
                <p className="text-xs text-muted-foreground mt-1">
                  Try adjusting the filters or expanding the date range.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    {colDefs.map((col) => (
                      <TableHead
                        key={col.key}
                        className="whitespace-nowrap font-semibold cursor-pointer select-none hover:text-foreground"
                        onClick={() => handleSort(col.key)}
                      >
                        {col.label}
                        <SortIcon col={col.key} />
                      </TableHead>
                    ))}
                    <TableHead
                      className="whitespace-nowrap font-semibold text-right cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort('callCount')}
                    >
                      Calls <SortIcon col="callCount" />
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap font-semibold text-right cursor-pointer select-none hover:text-foreground"
                      onClick={() => handleSort('uniqueLeads')}
                    >
                      Unique Leads <SortIcon col="uniqueLeads" />
                    </TableHead>
                    <TableHead className="whitespace-nowrap font-semibold text-right">
                      Call Rate
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((row, i) => {
                    const callRate = row.uniqueLeads > 0
                      ? Math.round((row.callCount / row.uniqueLeads) * 10) / 10
                      : 0;
                    return (
                      <TableRow key={i} className="hover:bg-muted/20">
                        {colDefs.map((col) => {
                          const val = col.value(row);
                          return (
                            <TableCell key={col.key} className="whitespace-nowrap">
                              {col.key === 'feedbackLabel' ? (
                                <Badge variant="outline" className="font-normal">
                                  {val ?? '—'}
                                </Badge>
                              ) : col.key === 'agentName' ? (
                                <span className="font-medium">{val ?? '—'}</span>
                              ) : (
                                <span className="text-muted-foreground">{val ?? '—'}</span>
                              )}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-right font-semibold tabular-nums">
                          {row.callCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {row.uniqueLeads.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground text-xs">
                          {callRate}×
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}
