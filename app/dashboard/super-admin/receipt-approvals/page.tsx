'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Receipt, Loader2, Search, CheckCircle2, XCircle, Clock, ExternalLink,
  GraduationCap, School, Banknote, Hash, CalendarDays, UserRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useUndoable } from '@/components/shared/use-undoable';
import { cn, formatDateTime } from '@/lib/utils';

type ReceiptKind = 'APPLICATION' | 'ADMISSION';
type ReceiptStatusFilter = 'PENDING' | 'APPROVED' | 'DISAPPROVED' | 'ALL';

interface ReceiptRow {
  id: string;
  type: ReceiptKind;
  status: 'PENDING' | 'APPROVED' | 'DISAPPROVED';
  campusName: string;
  courseName: string;
  receiptNumber: string;
  amountPaid: string;
  paidDate: string;
  studentName: string;
  email: string;
  mobile: string;
  createdAt: string;
  reviewedAt: string | null;
  disapprovalReason: string | null;
  lead: { id: string; name: string; phone: string; assignedTo: { id: string; name: string } | null } | null;
  uploadedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
}

interface ReceiptsResponse {
  receipts: ReceiptRow[];
  total: number;
  totalPages: number;
  counts: { PENDING: number; APPROVED: number; DISAPPROVED: number };
}

const TYPE_META: Record<ReceiptKind, { label: string; chip: string; badge: string }> = {
  APPLICATION: {
    label: 'Application',
    chip: 'bg-blue-600 text-white',
    badge: 'border-blue-300/50 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  },
  ADMISSION: {
    label: 'Admission',
    chip: 'bg-emerald-600 text-white',
    badge: 'border-emerald-300/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
};

const STATUS_TABS: { key: ReceiptStatusFilter; label: string }[] = [
  { key: 'PENDING', label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'DISAPPROVED', label: 'Disapproved' },
  { key: 'ALL', label: 'All' },
];

function StatusBadge({ status }: { status: ReceiptRow['status'] }) {
  if (status === 'APPROVED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/50 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Approved
      </span>
    );
  }
  if (status === 'DISAPPROVED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-red-300/50 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold text-red-700 dark:text-red-400">
        <XCircle className="h-3 w-3" /> Disapproved
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-400">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}

function DetailChip({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Icon className="h-3 w-3 shrink-0" /> {children}
    </span>
  );
}

// ─── Disapprove reason dialog ──────────────────────────────────────────────────

function DisapproveDialog({
  open, onClose, onConfirm, isPending,
}: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void; isPending: boolean }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setReason(''); } }}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Disapprove receipt</DialogTitle></DialogHeader>
        <div className="space-y-2 py-2">
          <label className="text-xs font-semibold text-foreground/80">
            Reason <span className="text-destructive">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Receipt amount doesn't match, wrong course selected…"
            className="flex min-h-[90px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-[11px] text-muted-foreground">
            The agent will see this reason and can upload a corrected receipt.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onClose(); setReason(''); }}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={!reason.trim() || isPending}
            onClick={() => { onConfirm(reason.trim()); setReason(''); }}
          >
            {isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Disapprove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────────

export default function ReceiptApprovalsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const undoable = useUndoable();

  const [statusFilter, setStatusFilter] = useState<ReceiptStatusFilter>('PENDING');
  const [typeFilter, setTypeFilter] = useState<ReceiptKind | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [disapproveTarget, setDisapproveTarget] = useState<ReceiptRow | null>(null);
  // Optimistically hidden while their undo toast is open
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching } = useQuery<ReceiptsResponse>({
    queryKey: ['receipt-approvals', statusFilter, typeFilter, search, page],
    queryFn: async () => {
      const p = new URLSearchParams({ status: statusFilter, page: String(page), limit: '25' });
      if (typeFilter !== 'ALL') p.set('type', typeFilter);
      if (search.trim()) p.set('search', search.trim());
      const r = await fetch(`/api/receipts?${p}`);
      if (!r.ok) throw new Error(`Failed to load receipts (HTTP ${r.status})`);
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const receipts = (data?.receipts ?? []).filter((r) => !hiddenIds.has(r.id));
  const counts = data?.counts ?? { PENDING: 0, APPROVED: 0, DISAPPROVED: 0 };
  const totalPages = data?.totalPages ?? 1;

  function review(receipt: ReceiptRow, action: 'APPROVE' | 'DISAPPROVE', reason?: string) {
    setHiddenIds((s) => new Set(s).add(receipt.id));
    const label = `${TYPE_META[receipt.type].label} receipt for ${receipt.studentName}`;
    undoable({
      title: action === 'APPROVE' ? `Approved — ${label}` : `Disapproved — ${label}`,
      description: action === 'APPROVE'
        ? `Primary ${receipt.type === 'APPLICATION' ? 'App.' : 'Adm.'} Confirm will be set to Yes.`
        : reason,
      onExecute: async () => {
        try {
          const r = await fetch(`/api/leads/${receipt.lead?.id}/receipts/${receipt.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, reason }),
          });
          const json = await r.json().catch(() => null);
          if (!r.ok) throw new Error(typeof json?.error === 'string' ? json.error : 'Failed to save review');
          qc.invalidateQueries({ queryKey: ['receipt-approvals'] });
        } catch (err) {
          // Roll back the optimistic hide so the SA can retry
          setHiddenIds((s) => { const n = new Set(s); n.delete(receipt.id); return n; });
          toast({
            variant: 'destructive',
            title: 'Review failed',
            description: err instanceof Error ? err.message : 'Something went wrong',
          });
        }
      },
      onUndo: () => setHiddenIds((s) => { const n = new Set(s); n.delete(receipt.id); return n; }),
    });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl sm:text-2xl font-bold">
            <Receipt className="h-5 w-5 sm:h-6 sm:w-6 text-primary" /> Receipt Approvals
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review Application and Admission receipts uploaded by agents. Approving a receipt marks the
            lead&apos;s Primary Confirm as Yes; disapproving lets the agent fix and resend it.
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {(['PENDING', 'APPROVED', 'DISAPPROVED'] as const).map((key) => {
          const meta = key === 'PENDING'
            ? { label: 'Pending', color: 'text-amber-600', Icon: Clock }
            : key === 'APPROVED'
              ? { label: 'Approved', color: 'text-emerald-600', Icon: CheckCircle2 }
              : { label: 'Disapproved', color: 'text-red-600', Icon: XCircle };
          return (
            <button
              key={key}
              onClick={() => { setStatusFilter(key); setPage(1); }}
              className={cn(
                'rounded-xl border p-3 sm:p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm',
                statusFilter === key ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20' : 'border-border/60 bg-card',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{meta.label}</span>
                <meta.Icon className={cn('h-4 w-4', meta.color)} />
              </div>
              <p className={cn('mt-1 text-2xl font-bold tabular-nums', meta.color)}>{counts[key]}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border text-sm shrink-0">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setStatusFilter(t.key); setPage(1); }}
              className={cn(
                'px-3 py-1.5 font-medium transition-colors',
                statusFilter === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex overflow-hidden rounded-lg border text-sm shrink-0">
          {(['ALL', 'APPLICATION', 'ADMISSION'] as const).map((t) => (
            <button
              key={t}
              onClick={() => { setTypeFilter(t); setPage(1); }}
              className={cn(
                'px-3 py-1.5 font-medium capitalize transition-colors',
                typeFilter === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted/50',
              )}
            >
              {t === 'ALL' ? 'All Types' : TYPE_META[t].label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search student, email, phone, receipt #, LID…"
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        {isFetching && !isLoading && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Updating…
          </span>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : receipts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border py-16 text-center">
          <Receipt className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium text-muted-foreground">
            {statusFilter === 'PENDING' ? 'No receipts waiting for approval' : 'No receipts found'}
          </p>
          <p className="text-xs text-muted-foreground/70">
            {statusFilter === 'PENDING' && 'New uploads from agents will show up here automatically.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {receipts.map((r) => {
            const t = TYPE_META[r.type];
            return (
              <div key={r.id} className="rounded-xl border border-border/60 bg-card p-3.5 sm:p-4 transition-colors hover:bg-muted/20">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  {/* Left: identity + details */}
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', t.chip)}>
                        <Receipt className="h-3.5 w-3.5" />
                      </span>
                      <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', t.badge)}>
                        {t.label}
                      </span>
                      <StatusBadge status={r.status} />
                      {r.lead ? (
                        <a
                          href={`/leads/${r.lead.id}/profile`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm font-semibold hover:text-primary hover:underline"
                        >
                          {r.studentName} <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-sm font-semibold">{r.studentName}</span>
                      )}
                      <span className="font-mono text-[10px] text-muted-foreground">{r.lead?.id}</span>
                    </div>

                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      <DetailChip icon={School}>{r.campusName}</DetailChip>
                      <DetailChip icon={GraduationCap}>{r.courseName}</DetailChip>
                      <DetailChip icon={Banknote}>₹{r.amountPaid}</DetailChip>
                      <DetailChip icon={Hash}>{r.receiptNumber}</DetailChip>
                      <DetailChip icon={CalendarDays}>{new Date(r.paidDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</DetailChip>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <UserRound className="h-3 w-3" /> Uploaded by <strong className="font-medium text-foreground/80">{r.uploadedBy.name}</strong> · {formatDateTime(r.createdAt)}
                      </span>
                      {r.reviewedBy && (
                        <span>
                          Reviewed by <strong className="font-medium text-foreground/80">{r.reviewedBy.name}</strong>
                          {r.reviewedAt && ` · ${formatDateTime(r.reviewedAt)}`}
                        </span>
                      )}
                    </div>

                    {r.status === 'DISAPPROVED' && r.disapprovalReason && (
                      <p className="rounded-md border border-red-200/60 bg-red-500/5 px-2.5 py-1.5 text-[11px] text-red-700 dark:border-red-900/40 dark:text-red-400">
                        <strong>Reason:</strong> {r.disapprovalReason}
                      </p>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-stretch">
                    <a
                      href={`/api/leads/${r.lead?.id}/receipts/${r.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors hover:bg-muted/60"
                    >
                      View Receipt <ExternalLink className="h-3 w-3" />
                    </a>
                    {r.status === 'PENDING' && (
                      <div className="flex gap-2">
                        <button
                          onClick={() => review(r, 'APPROVE')}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </button>
                        <button
                          onClick={() => setDisapproveTarget(r)}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-300/60 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-500/20 disabled:opacity-50 dark:text-red-400"
                        >
                          <XCircle className="h-3.5 w-3.5" /> Disapprove
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <DisapproveDialog
        open={!!disapproveTarget}
        isPending={false}
        onClose={() => setDisapproveTarget(null)}
        onConfirm={(reason) => {
          if (disapproveTarget) review(disapproveTarget, 'DISAPPROVE', reason);
          setDisapproveTarget(null);
        }}
      />
    </div>
  );
}
