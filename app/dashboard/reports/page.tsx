'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/lib/usePermissions';
import {
  CheckCircle, XCircle, Trash2, Download, Eye, EyeOff,
  Loader2, Search, ChevronDown, ChevronRight, AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { LeadDetailModal } from '@/components/leads/lead-detail-modal';
import { maskEmail, maskPhone } from '@/lib/csv-parser';
import { formatDateTime } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string; name: string; email: string; phone: string;
  city?: string | null; state?: string | null; course?: string | null;
  college?: string | null; campaign?: string | null;
  leadType?: string | null; leadOrigin?: string | null; leadZone?: string | null;
  status: 'PENDING' | 'APPROVED' | 'DISAPPROVED';
  createdAt: string; updatedAt: string;
  disapprovalReason?: string | null;
  uploadedBy: { id: string; name: string };
  approvedBy?: { id: string; name: string } | null;
  disapprovedBy?: { id: string; name: string } | null;
  assignedTo?: { id: string; name: string } | null;
  assignedBy?: { id: string; name: string } | null;
  feedbacks: unknown[];
  _count: { feedbacks: number };
  batch?: { id: string; fileName: string; createdAt: string } | null;
}

interface LeadsResponse { leads: Lead[]; total: number; totalPages: number }

// ─── CSV download helper ──────────────────────────────────────────────────────

function csvEsc(v: string | null | undefined): string {
  const s = v ?? '';
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadLeadsAsCSV(leads: Lead[], filename: string) {
  const headers = ['name', 'email', 'phone', 'city', 'state', 'course', 'college', 'campaign', 'lead_type', 'lead_origin', 'lead_zone', 'status'];
  const rows = leads.map((l) => [
    l.name, l.email, l.phone,
    l.city, l.state, l.course, l.college,
    l.campaign, l.leadType, l.leadOrigin, l.leadZone,
    l.status,
  ].map(csvEsc).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ status }: { status: Lead['status'] }) {
  return (
    <Badge variant={status === 'APPROVED' ? 'success' : status === 'DISAPPROVED' ? 'destructive' : 'warning'}>
      {status}
    </Badge>
  );
}

// ─── Skeleton loader row ──────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <TableRow>
      {Array.from({ length: 11 }).map((_, i) => (
        <TableCell key={i}><div className="h-4 rounded bg-muted animate-pulse" /></TableCell>
      ))}
    </TableRow>
  );
}

// ─── Disapprove reason modal ──────────────────────────────────────────────────

interface DisapproveModalProps {
  open: boolean;
  title: string;
  onConfirm: (reason: string) => void;
  onClose: () => void;
  isPending: boolean;
}

function DisapproveModal({ open, title, onConfirm, onClose, isPending }: DisapproveModalProps) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2">
          <Label>Reason for disapproval <span className="text-destructive">*</span></Label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Enter reason..."
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!reason.trim() || isPending}
            onClick={() => { onConfirm(reason); setReason(''); }}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Disapprove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Batch section ────────────────────────────────────────────────────────────

interface BatchSectionProps {
  batchId: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  leads: Lead[];
  canUnmask: boolean;
  canApprove: boolean;
  isSearchActive: boolean;
  onApproveOne: (id: string) => void;
  onDisapproveOne: (id: string) => void;
  onDeleteOne: (id: string) => void;
  onApproveAll: (batchId: string) => void;
  onDisapproveAll: (batchId: string) => void;
  onViewDetail: (lead: Lead) => void;
  isActionPending: boolean;
}

function BatchSection({
  batchId, fileName, uploadedAt, uploadedBy, leads, canUnmask, canApprove,
  isSearchActive, onApproveOne, onDisapproveOne, onDeleteOne, onApproveAll, onDisapproveAll,
  onViewDetail, isActionPending,
}: BatchSectionProps) {
  const [open, setOpen] = useState(false);

  // Auto-open when user is searching so filtered results are visible
  useEffect(() => {
    if (isSearchActive) setOpen(true);
  }, [isSearchActive]);
  const pendingCount = leads.filter((l) => l.status === 'PENDING').length;
  const approvedCount = leads.filter((l) => l.status === 'APPROVED').length;
  const disapprovedCount = leads.filter((l) => l.status === 'DISAPPROVED').length;

  const pendingLeads = leads.filter((l) => l.status === 'PENDING');

  return (
    <Card className="border-l-4 border-l-primary/30">
      {/* Batch header */}
      <div className="flex w-full items-center gap-3 px-4 py-3">
        <button
          className="flex flex-1 min-w-0 items-center gap-3 text-left"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{fileName}</p>
            <p className="text-xs text-muted-foreground">
              Uploaded by <span className="font-medium">{uploadedBy}</span> · {formatDateTime(uploadedAt)} · {leads.length} records
            </p>
          </div>
        </button>
        <div className="flex items-center gap-2 shrink-0">
          {pendingCount > 0 && <Badge variant="warning">{pendingCount} pending</Badge>}
          {approvedCount > 0 && <Badge variant="success">{approvedCount} approved</Badge>}
          {disapprovedCount > 0 && <Badge variant="destructive">{disapprovedCount} rejected</Badge>}
          {canApprove && pendingLeads.length > 0 && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-xs gap-1.5"
              title="Download pending leads as CSV"
              onClick={(e) => {
                e.stopPropagation();
                const safeName = fileName.replace(/[^a-z0-9_\-\.]/gi, '_').replace(/\.csv$/i, '');
                downloadLeadsAsCSV(pendingLeads, `pending_${safeName}.csv`);
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Download Pending
            </Button>
          )}
        </div>
      </div>

      {open && (
        <div className="px-4 pb-4 space-y-3">
          {/* Batch action buttons */}
          {pendingCount > 0 && canApprove && (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="text-green-700 border-green-200 hover:bg-green-50"
                disabled={isActionPending}
                onClick={() => onApproveAll(batchId)}>
                <CheckCircle className="mr-1 h-3.5 w-3.5" /> Approve All ({pendingCount})
              </Button>
              <Button size="sm" variant="outline" className="text-red-700 border-red-200 hover:bg-red-50"
                disabled={isActionPending}
                onClick={() => onDisapproveAll(batchId)}>
                <XCircle className="mr-1 h-3.5 w-3.5" /> Disapprove All ({pendingCount})
              </Button>
            </div>
          )}

          <div className="overflow-x-auto rounded-md border">
            <Table className="text-xs">
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="whitespace-nowrap font-semibold">Name</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">Email</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">Phone</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">City</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">State</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">Course</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">College</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">Campaign</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">Lead Type</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">Lead Origin</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">Zone</TableHead>
                  <TableHead className="whitespace-nowrap font-semibold">Status</TableHead>
                  <TableHead className="whitespace-nowrap text-right font-semibold">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow key={lead.id} className="hover:bg-muted/20">
                    <TableCell
                      className="font-semibold cursor-pointer hover:text-primary whitespace-nowrap"
                      onClick={() => onViewDetail(lead)}
                    >
                      {lead.name}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {canUnmask ? lead.email : maskEmail(lead.email)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-medium text-teal-600 dark:text-teal-400">
                      {canUnmask ? lead.phone : maskPhone(lead.phone)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{lead.city ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{lead.state ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{lead.course ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground max-w-[160px] truncate" title={lead.college ?? ''}>{lead.college ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{lead.campaign ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{lead.leadType ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{lead.leadOrigin ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{lead.leadZone ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap"><StatusBadge status={lead.status} /></TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {lead.status === 'PENDING' && canApprove && (
                          <>
                            <Button size="icon" variant="ghost" title="Approve"
                              disabled={isActionPending}
                              onClick={() => onApproveOne(lead.id)}>
                              <CheckCircle className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button size="icon" variant="ghost" title="Disapprove"
                              disabled={isActionPending}
                              onClick={() => onDisapproveOne(lead.id)}>
                              <XCircle className="h-4 w-4 text-red-600" />
                            </Button>
                          </>
                        )}
                        {lead.status === 'DISAPPROVED' && canApprove && (
                          <Button size="icon" variant="ghost" title="Delete"
                            disabled={isActionPending}
                            onClick={() => onDeleteOne(lead.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                        {lead.status === 'APPROVED' && (
                          <span className="text-xs text-muted-foreground px-2 py-1">
                            {lead.approvedBy?.name ?? ''}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Show disapproval reason if any */}
          {leads.some((l) => l.disapprovalReason) && (
            <div className="space-y-1">
              {leads.filter((l) => l.disapprovalReason).map((l) => (
                <p key={l.id} className="text-xs text-muted-foreground">
                  <span className="font-medium">{l.name}</span>: {l.disapprovalReason}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const { can } = usePermissions();

  const [searchInput, setSearchInput] = useState('');
  const [search,      setSearch]      = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [page, setPage] = useState(1);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [maskData, setMaskData] = useState(true);

  const canApproveleads = can('APPROVE_LEADS');
  const canDownload     = can('DOWNLOAD_DATA');
  const canToggleMask   = can('MASK_UNMASK_DATA');

  // Disapprove modal state
  const [disapproveTarget, setDisapproveTarget] = useState<
    { type: 'single'; id: string } | { type: 'batch'; batchId: string } | null
  >(null);

  const { data, isLoading, isError, refetch } = useQuery<LeadsResponse>({
    queryKey: ['leads-reports', statusFilter, search, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), limit: '100' });
      if (statusFilter && statusFilter !== 'ALL') p.set('status', statusFilter);
      if (search) p.set('search', search);
      return fetch(`/api/leads?${p}`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      });
    },
    enabled: !!session?.user?.id,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: 'APPROVE' | 'DISAPPROVE'; reason?: string }) =>
      fetch(`/api/leads/${id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason }),
      }).then(async (r) => {
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? 'Unknown error');
        return json;
      }),
    onSuccess: () => {
      toast({ title: 'Lead updated successfully' });
      qc.invalidateQueries({ queryKey: ['leads-reports'] });
      setDisapproveTarget(null);
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Action failed', description: err.message });
    },
  });

  const batchApproveMutation = useMutation({
    mutationFn: (batchId: string) =>
      fetch(`/api/leads/batch/${batchId}/approve`, { method: 'PATCH' }).then(async (r) => {
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? 'Unknown error');
        return json;
      }),
    onSuccess: (data) => {
      const msg = data.skipped > 0
        ? `Approved ${data.approved} leads. ${data.skipped} skipped (invalid data).`
        : `Approved ${data.approved} leads.`;
      toast({ title: msg });
      qc.invalidateQueries({ queryKey: ['leads-reports'] });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Batch approve failed', description: err.message });
    },
  });

  const batchDisapproveMutation = useMutation({
    mutationFn: ({ batchId, reason }: { batchId: string; reason: string }) =>
      fetch(`/api/leads/batch/${batchId}/disapprove`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      }).then(async (r) => {
        const json = await r.json();
        if (!json.success) throw new Error(json.error ?? 'Unknown error');
        return json;
      }),
    onSuccess: (data) => {
      toast({ title: `Disapproved ${data.disapproved} leads.` });
      qc.invalidateQueries({ queryKey: ['leads-reports'] });
      setDisapproveTarget(null);
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Batch disapprove failed', description: err.message });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/leads/${id}`, { method: 'DELETE' }).then(async (r) => {
        const json = await r.json();
        if (json.success === false) throw new Error(json.error ?? 'Delete failed');
        return json;
      }),
    onSuccess: () => {
      toast({ title: 'Lead deleted' });
      qc.invalidateQueries({ queryKey: ['leads-reports'] });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Delete failed', description: err.message });
    },
  });

  const isAnyPending =
    approveMutation.isPending || batchApproveMutation.isPending || batchDisapproveMutation.isPending || deleteMutation.isPending;

  const canUnmask = !maskData && canToggleMask;

  // Group leads by batch
  const leads = data?.leads ?? [];
  const batchMap = new Map<string, { fileName: string; uploadedAt: string; uploadedBy: string; leads: Lead[] }>();
  const noBatchLeads: Lead[] = [];

  for (const lead of leads) {
    if (lead.batch?.id) {
      const existing = batchMap.get(lead.batch.id);
      if (existing) {
        existing.leads.push(lead);
      } else {
        batchMap.set(lead.batch.id, {
          fileName: lead.batch.fileName,
          uploadedAt: lead.batch.createdAt,
          uploadedBy: lead.uploadedBy.name,
          leads: [lead],
        });
      }
    } else {
      noBatchLeads.push(lead);
    }
  }

  const handleDisapproveConfirm = (reason: string) => {
    if (!disapproveTarget) return;
    if (disapproveTarget.type === 'single') {
      approveMutation.mutate({ id: disapproveTarget.id, action: 'DISAPPROVE', reason });
    } else {
      batchDisapproveMutation.mutate({ batchId: disapproveTarget.batchId, reason });
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, phone..."
            className="pl-9"
            value={searchInput}
            onChange={(e) => {
              const v = e.target.value;
              setSearchInput(v);
              clearTimeout(debounceRef.current);
              debounceRef.current = setTimeout(() => { setSearch(v); setPage(1); }, 350);
            }}
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Status</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="APPROVED">Approved</SelectItem>
            <SelectItem value="DISAPPROVED">Disapproved</SelectItem>
          </SelectContent>
        </Select>
        {canToggleMask && (
          <Button size="sm" variant="outline" onClick={() => setMaskData((v) => !v)}>
            {maskData ? <Eye className="mr-1 h-3.5 w-3.5" /> : <EyeOff className="mr-1 h-3.5 w-3.5" />}
            {maskData ? 'Unmask' : 'Mask'}
          </Button>
        )}
        {canDownload && (
          <Button size="sm" variant="outline" onClick={() => {
            const p = statusFilter && statusFilter !== 'ALL' ? `?status=${statusFilter}` : '';
            window.open(`/api/leads/export${p}`, '_blank');
          }}>
            <Download className="mr-1 h-3.5 w-3.5" /> Export CSV
          </Button>
        )}
      </div>

      {/* Error state */}
      {isError && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-6 flex items-center justify-between">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span className="text-sm font-medium">Failed to load leads. Check your connection.</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <Card>
          <CardHeader><CardTitle>Loading…</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableBody>{Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)}</TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!isLoading && !isError && leads.length === 0 && (
        <Card>
          <CardContent className="py-16 flex flex-col items-center gap-3 text-center">
            <CheckCircle className="h-10 w-10 text-muted-foreground/40" />
            <p className="font-medium text-muted-foreground">
              {statusFilter === 'PENDING'
                ? 'No leads pending approval.'
                : `No ${statusFilter.toLowerCase()} leads found.`}
            </p>
            {statusFilter === 'PENDING' && (
              <p className="text-sm text-muted-foreground">
                Leads will appear here after Operations uploads a CSV.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Batch grouped view */}
      {!isLoading && !isError && leads.length > 0 && (
        <div className="space-y-4">
          {Array.from(batchMap.entries()).map(([batchId, batch]) => (
            <BatchSection
              key={batchId}
              batchId={batchId}
              fileName={batch.fileName}
              uploadedAt={batch.uploadedAt}
              uploadedBy={batch.uploadedBy}
              leads={batch.leads}
              canUnmask={canUnmask}
              canApprove={canApproveleads}
              isSearchActive={!!search}
              isActionPending={isAnyPending}
              onApproveOne={(id) => approveMutation.mutate({ id, action: 'APPROVE' })}
              onDisapproveOne={(id) => setDisapproveTarget({ type: 'single', id })}
              onDeleteOne={(id) => deleteMutation.mutate(id)}
              onApproveAll={(bid) => batchApproveMutation.mutate(bid)}
              onDisapproveAll={(bid) => setDisapproveTarget({ type: 'batch', batchId: bid })}
              onViewDetail={setSelectedLead}
            />
          ))}

          {/* Leads without a batch */}
          {noBatchLeads.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-sm text-muted-foreground">Unclassified Leads</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead>
                      <TableHead>Course</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {noBatchLeads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell className="font-medium cursor-pointer hover:text-primary"
                          onClick={() => setSelectedLead(lead)}>{lead.name}</TableCell>
                        <TableCell>{canUnmask ? lead.email : maskEmail(lead.email)}</TableCell>
                        <TableCell>{canUnmask ? lead.phone : maskPhone(lead.phone)}</TableCell>
                        <TableCell>{lead.course ?? '—'}</TableCell>
                        <TableCell><StatusBadge status={lead.status} /></TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {lead.status === 'PENDING' && canApproveleads && (
                              <>
                                <Button size="icon" variant="ghost" title="Approve" disabled={isAnyPending}
                                  onClick={() => approveMutation.mutate({ id: lead.id, action: 'APPROVE' })}>
                                  <CheckCircle className="h-4 w-4 text-green-600" />
                                </Button>
                                <Button size="icon" variant="ghost" title="Disapprove" disabled={isAnyPending}
                                  onClick={() => setDisapproveTarget({ type: 'single', id: lead.id })}>
                                  <XCircle className="h-4 w-4 text-red-600" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Page {page} of {data.totalPages} · {data.total} total</p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                <Button variant="outline" size="sm" onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages}>Next</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Disapprove reason modal */}
      <DisapproveModal
        open={!!disapproveTarget}
        title={disapproveTarget?.type === 'batch' ? 'Disapprove Entire Batch' : 'Disapprove Lead'}
        onConfirm={handleDisapproveConfirm}
        onClose={() => setDisapproveTarget(null)}
        isPending={approveMutation.isPending || batchDisapproveMutation.isPending}
      />

      <LeadDetailModal
        lead={selectedLead as Parameters<typeof LeadDetailModal>[0]['lead']}
        open={!!selectedLead}
        onClose={() => setSelectedLead(null)}
        canUnmask={canUnmask}
      />
    </div>
  );
}
