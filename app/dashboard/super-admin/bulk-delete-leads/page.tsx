'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Trash2, AlertTriangle, Loader2, Search, RotateCcw, Database, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { MultiSelectFilter, type MultiSelectOption } from '@/components/shared/multi-select-filter';
import { PinGate } from '@/components/shared/pin-gate';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';
import { cn } from '@/lib/utils';

interface UploadBatchOption {
  id: string;
  fileName: string;
  createdAt: string;
  totalRecords: number;
  uploadedBy: { id: string; name: string };
  _count: { leads: number };
}

interface DropdownFilterOptions {
  campaigns: string[];
  leadTypes: string[];
  leadOrigins: string[];
  leadZones: string[];
  cities: string[];
  states: string[];
  colleges: string[];
  courses: string[];
}

interface PreviewLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  city: string | null;
  state: string | null;
  college: string | null;
  status: 'PENDING' | 'APPROVED' | 'DISAPPROVED';
  createdAt: string;
  uploadedBy: { name: string } | null;
  batch: { fileName: string } | null;
}

interface PreviewResponse {
  success: true;
  total: number;
  sample: PreviewLead[];
}

interface FilterState {
  batchId: string;
  uploadedById: string;
  status: string;
  campaign: string[];
  city: string[];
  state: string[];
  course: string[];
  college: string[];
  leadType: string[];
  leadOrigin: string[];
  zone: string[];
  dateFrom: string;
  dateTo: string;
  search: string;
}

const EMPTY_FILTERS: FilterState = {
  batchId: '', uploadedById: '', status: '', campaign: [], city: [], state: [],
  course: [], college: [], leadType: [], leadOrigin: [], zone: [], dateFrom: '', dateTo: '', search: '',
};

const STATUS_LABEL: Record<PreviewLead['status'], string> = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DISAPPROVED: 'Disapproved',
};

const STATUS_BADGE: Record<PreviewLead['status'], string> = {
  PENDING: 'border-amber-300/50 bg-amber-500/10 text-amber-700 dark:text-amber-400',
  APPROVED: 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  DISAPPROVED: 'border-red-300/50 bg-red-500/10 text-red-700 dark:text-red-400',
};

function hasAnyFilter(f: FilterState): boolean {
  return (
    f.batchId !== '' || f.uploadedById !== '' || f.status !== '' ||
    f.campaign.length > 0 || f.city.length > 0 || f.state.length > 0 ||
    f.course.length > 0 || f.college.length > 0 || f.leadType.length > 0 ||
    f.leadOrigin.length > 0 || f.zone.length > 0 ||
    f.dateFrom !== '' || f.dateTo !== '' || f.search.trim() !== ''
  );
}

function buildParams(f: FilterState): URLSearchParams {
  const p = new URLSearchParams();
  if (f.batchId) p.set('batchId', f.batchId);
  if (f.uploadedById) p.set('uploadedById', f.uploadedById);
  if (f.status) p.set('status', f.status);
  if (f.campaign.length > 0) p.set('campaign', f.campaign.join(','));
  if (f.city.length > 0) p.set('city', f.city.join(','));
  if (f.state.length > 0) p.set('state', f.state.join(','));
  if (f.course.length > 0) p.set('course', f.course.join(','));
  if (f.college.length > 0) p.set('college', f.college.join(','));
  if (f.leadType.length > 0) p.set('leadType', f.leadType.join(','));
  if (f.leadOrigin.length > 0) p.set('leadOrigin', f.leadOrigin.join(','));
  if (f.zone.length > 0) p.set('zone', f.zone.join(','));
  if (f.dateFrom) p.set('dateFrom', f.dateFrom);
  if (f.dateTo) p.set('dateTo', f.dateTo);
  if (f.search.trim()) p.set('search', f.search.trim());
  return p;
}

export default function BulkDeleteLeadsPage() {
  return (
    <PinGate action={PIN_GATED_ACTIONS.BULK_DELETE_LEADS} title="Bulk Delete Leads">
      <BulkDeleteLeadsContent />
    </PinGate>
  );
}

function BulkDeleteLeadsContent() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<FilterState | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const set = <K extends keyof FilterState>(key: K, value: FilterState[K]) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const { data: batches = [] } = useQuery<UploadBatchOption[]>({
    queryKey: ['upload-batches-for-bulk-delete'],
    queryFn: () => fetch('/api/upload').then((r) => r.json()).then((d) => (Array.isArray(d) ? d : [])),
  });

  const uploaders = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of batches) map.set(b.uploadedBy.id, b.uploadedBy.name);
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [batches]);

  // Sourced from every lead regardless of status (unlike the All Leads page's
  // dropdowns, which only reflect APPROVED leads) — a mistaken upload is
  // often still PENDING, and it must still show up here.
  const { data: dropdownOptions, isLoading: optsLoading } = useQuery<DropdownFilterOptions>({
    queryKey: ['bulk-delete-filter-options'],
    queryFn: () => fetch('/api/leads/bulk-delete/filter-options').then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  const str2opt = (arr: string[] = []): MultiSelectOption[] => arr.map((v) => ({ value: v, label: v }));
  const campaignOptions   = useMemo(() => str2opt(dropdownOptions?.campaigns),   [dropdownOptions]);
  const cityOptions       = useMemo(() => str2opt(dropdownOptions?.cities),      [dropdownOptions]);
  const stateOptions      = useMemo(() => str2opt(dropdownOptions?.states),      [dropdownOptions]);
  const courseOptions     = useMemo(() => str2opt(dropdownOptions?.courses),     [dropdownOptions]);
  const collegeOptions    = useMemo(() => str2opt(dropdownOptions?.colleges),    [dropdownOptions]);
  const leadTypeOptions   = useMemo(() => str2opt(dropdownOptions?.leadTypes),   [dropdownOptions]);
  const leadOriginOptions = useMemo(() => str2opt(dropdownOptions?.leadOrigins), [dropdownOptions]);
  const zoneOptions       = useMemo(() => str2opt(dropdownOptions?.leadZones),   [dropdownOptions]);

  const previewMutation = useMutation({
    mutationFn: async (f: FilterState) => {
      const r = await fetch(`/api/leads/bulk-delete/preview?${buildParams(f)}`);
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to load preview');
      return json as PreviewResponse;
    },
    onSuccess: (_data, f) => setAppliedFilters(f),
    onError: (err: Error) => toast({ variant: 'destructive', title: 'Preview failed', description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!appliedFilters || !previewMutation.data) throw new Error('Preview the results first');
      const params = buildParams(appliedFilters);
      const r = await fetch('/api/leads/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...Object.fromEntries(params.entries()), expectedCount: previewMutation.data.total }),
      });
      const json = await r.json();
      if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to delete leads');
      return json as { success: true; deleted: number };
    },
    onSuccess: (data) => {
      toast({
        title: `Deleted ${data.deleted} lead${data.deleted === 1 ? '' : 's'}`,
        description: 'Permanently removed, along with their feedback, receipts, and scheduled calls.',
      });
      setConfirmOpen(false);
      setConfirmText('');
      previewMutation.reset();
      setAppliedFilters(null);
      setFilters(EMPTY_FILTERS);
      qc.invalidateQueries({ queryKey: ['upload-batches-for-bulk-delete'] });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Delete failed', description: err.message });
      // A stale/mismatched count means the preview is out of date — force a
      // re-preview rather than let the admin retry blind against old numbers.
      if (err.message.includes('changed since')) {
        previewMutation.reset();
        setAppliedFilters(null);
      }
    },
  });

  const filtersDirty = JSON.stringify(filters) !== JSON.stringify(appliedFilters);
  const preview = !filtersDirty ? previewMutation.data : undefined;
  const total = preview?.total ?? 0;

  function handlePreview() {
    if (!hasAnyFilter(filters)) {
      toast({ variant: 'destructive', title: 'Apply at least one filter', description: 'This tool will not target every lead unscoped.' });
      return;
    }
    previewMutation.mutate(filters);
  }

  function handleReset() {
    setFilters(EMPTY_FILTERS);
    setAppliedFilters(null);
    previewMutation.reset();
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
          <Trash2 className="h-5 w-5 sm:h-6 sm:w-6 text-destructive" /> Bulk Delete Leads
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Permanently remove leads that were uploaded by mistake. Apply filters to narrow down exactly which
          leads to remove, review them, then confirm — this cannot be undone.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-300/50 bg-amber-500/10 px-3.5 py-3 text-xs text-amber-800 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <p>
          Deleting a lead also permanently removes its feedback history, uploaded receipts, scheduled calls,
          and profile data. There is no trash/undo — always preview and review the sample below before confirming.
        </p>
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-border/60 bg-card p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Filters</h2>
          <span className="text-xs text-muted-foreground">— at least one is required</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Upload Batch (CSV file)</Label>
            <Select value={filters.batchId || '__any__'} onValueChange={(v) => set('batchId', v === '__any__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Any batch" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any batch</SelectItem>
                {batches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.fileName} · {new Date(b.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · {b._count.leads} lead{b._count.leads === 1 ? '' : 's'} left
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Uploaded By</Label>
            <Select value={filters.uploadedById || '__any__'} onValueChange={(v) => set('uploadedById', v === '__any__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Anyone" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Anyone</SelectItem>
                {uploaders.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Status</Label>
            <Select value={filters.status || '__any__'} onValueChange={(v) => set('status', v === '__any__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Any status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any__">Any status</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="APPROVED">Approved</SelectItem>
                <SelectItem value="DISAPPROVED">Disapproved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Lead Code</Label>
            <MultiSelectFilter
              placeholder="Any lead code" options={campaignOptions} selected={filters.campaign}
              onChange={(v) => set('campaign', v)} loading={optsLoading} triggerClassName="h-10 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">City</Label>
            <MultiSelectFilter
              placeholder="Any city" options={cityOptions} selected={filters.city}
              onChange={(v) => set('city', v)} loading={optsLoading} triggerClassName="h-10 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">State</Label>
            <MultiSelectFilter
              placeholder="Any state" options={stateOptions} selected={filters.state}
              onChange={(v) => set('state', v)} loading={optsLoading} triggerClassName="h-10 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Course</Label>
            <MultiSelectFilter
              placeholder="Any course" options={courseOptions} selected={filters.course}
              onChange={(v) => set('course', v)} loading={optsLoading} triggerClassName="h-10 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">College</Label>
            <MultiSelectFilter
              placeholder="Any college" options={collegeOptions} selected={filters.college}
              onChange={(v) => set('college', v)} loading={optsLoading} triggerClassName="h-10 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Lead Type</Label>
            <MultiSelectFilter
              placeholder="Any lead type" options={leadTypeOptions} selected={filters.leadType}
              onChange={(v) => set('leadType', v)} loading={optsLoading} triggerClassName="h-10 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Lead Origin</Label>
            <MultiSelectFilter
              placeholder="Any lead origin" options={leadOriginOptions} selected={filters.leadOrigin}
              onChange={(v) => set('leadOrigin', v)} loading={optsLoading} triggerClassName="h-10 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Zone</Label>
            <MultiSelectFilter
              placeholder="Any zone" options={zoneOptions} selected={filters.zone}
              onChange={(v) => set('zone', v)} loading={optsLoading} triggerClassName="h-10 w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Uploaded From</Label>
            <Input type="date" value={filters.dateFrom} onChange={(e) => set('dateFrom', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Uploaded To</Label>
            <Input type="date" value={filters.dateTo} onChange={(e) => set('dateTo', e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
            <Label className="text-xs">Search (name, email, phone, Lead ID)</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" value={filters.search} onChange={(e) => set('search', e.target.value)} placeholder="Search…" />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button onClick={handlePreview} disabled={previewMutation.isPending}>
            {previewMutation.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Search className="mr-1.5 h-4 w-4" />}
            Preview Matching Leads
          </Button>
          <Button variant="outline" onClick={handleReset}>
            <RotateCcw className="mr-1.5 h-4 w-4" /> Clear Filters
          </Button>
        </div>
      </div>

      {/* Results */}
      {preview && (
        <div className="space-y-3">
          {total === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-12 text-center">
              <Database className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No leads match these filters</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-3 rounded-lg border border-red-300/50 bg-red-500/10 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2 text-sm text-red-800 dark:text-red-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                  <p>
                    <strong className="font-bold">{total}</strong> lead{total === 1 ? '' : 's'} match{total === 1 ? 'es' : ''} these filters and will be{' '}
                    <strong className="font-bold">permanently deleted</strong>. This cannot be undone.
                  </p>
                </div>
                <Button variant="destructive" className="shrink-0" onClick={() => setConfirmOpen(true)}>
                  <Trash2 className="mr-1.5 h-4 w-4" /> Delete {total} Lead{total === 1 ? '' : 's'}
                </Button>
              </div>

              <div className="overflow-auto rounded-lg border border-border/60">
                <table className="w-full text-sm border-collapse">
                  <thead className="sticky top-0 z-20">
                    <tr className="border-b border-border/60 bg-muted">
                      <th className="sticky left-0 z-30 bg-muted border-r border-border/60 whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[170px]">Name</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[190px]">Email</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[120px]">Phone</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[110px]">City</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[160px]">College</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[110px]">Status</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[150px]">Uploaded By</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[170px]">Batch File</th>
                      <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[110px]">Uploaded At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.map((l) => (
                      <tr key={l.id} className="border-b border-border/40 last:border-0 hover:bg-muted/20">
                        <td className="sticky left-0 z-10 border-r border-border/60 bg-card px-3 py-2.5">
                          <a href={`/leads/${l.id}/profile`} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-sm font-semibold hover:text-primary hover:underline">
                            {l.name} <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                          <p className="font-mono text-[10px] text-muted-foreground">{l.id}</p>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{l.email}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs">{l.phone}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{l.city || '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{l.college || '—'}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={cn('inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold', STATUS_BADGE[l.status])}>
                            {STATUS_LABEL[l.status]}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{l.uploadedBy?.name || '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{l.batch?.fileName || '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(l.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {total > preview.sample.length && (
                <p className="text-xs text-muted-foreground">
                  Showing the {preview.sample.length} most recently uploaded of {total} matching leads. All {total} will be deleted, not just the ones shown here.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Confirm dialog */}
      <Dialog open={confirmOpen} onOpenChange={(v) => { if (!v && !deleteMutation.isPending) { setConfirmOpen(false); setConfirmText(''); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Confirm permanent deletion
            </DialogTitle>
            <DialogDescription>
              You are about to permanently delete <strong>{total}</strong> lead{total === 1 ? '' : 's'} and all of their
              feedback, receipts, and scheduled calls. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label className="text-xs font-semibold text-foreground/80">
              Type <strong className="font-mono">DELETE</strong> to confirm
            </Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={deleteMutation.isPending} onClick={() => { setConfirmOpen(false); setConfirmText(''); }}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={confirmText.trim() !== 'DELETE' || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Permanently Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
