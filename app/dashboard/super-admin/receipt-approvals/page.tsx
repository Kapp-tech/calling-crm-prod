'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Receipt, Loader2, Search, CheckCircle2, XCircle, Clock, ExternalLink, UserRound, Download,
  Users, Copy as CopyIcon,
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
  lead: { id: string; name: string; phone: string; campaign: string | null; assignedTo: { id: string; name: string } | null } | null;
  uploadedBy: { id: string; name: string };
  reviewedBy: { id: string; name: string } | null;
}

interface ReceiptsResponse {
  receipts: ReceiptRow[];
  total: number;
  totalPages: number;
  counts: { PENDING: number; APPROVED: number; DISAPPROVED: number };
  dupCounts: { unique: number; duplicate: number };
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
  // Paid-date range. Empty means unbounded on that side, so one box alone is a
  // valid filter ("everything from 1 Oct", "everything up to 30 Sept").
  /**
   * Repeat-student scope, separate from status.
   *
   * Both cards show students on more than one receipt; they differ on whether
   * the college differs too. Selecting one also resets status to ALL, because
   * the question "which of these repeat" is rarely meant as "…and are also
   * still pending" — and a card reading 6 that then lists 0 looks broken.
   */
  const [dup, setDup] = useState<'unique' | 'duplicate' | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [disapproveTarget, setDisapproveTarget] = useState<ReceiptRow | null>(null);
  // Optimistically hidden while their undo toast is open
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  /**
   * The filter params, built once and used by BOTH the table and the CSV
   * download. Two builders is how the All Leads export drifted from its list —
   * it downloaded 80,847 rows for a filter showing 8,145. Paging is deliberately
   * not in here: the table takes one page, the download takes every match.
   */
  /**
   * Downloads exactly what the current filters show.
   *
   * Fetched rather than a plain <a href>, so a failure surfaces as a toast
   * instead of a blank tab — the All Leads download once 413'd for weeks while
   * the client swallowed the error in an empty catch and looked like it had
   * simply done nothing.
   */
  const downloadCsv = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/receipts/export?${filterParams()}`);
      if (!res.ok) {
        const msg = await res.json().catch(() => null);
        throw new Error(msg?.error ?? `Download failed (HTTP ${res.status})`);
      }
      const blob = await res.blob();
      // Filename comes from the server's Content-Disposition so the file is
      // named the same way however it was triggered.
      const match = res.headers.get('content-disposition')?.match(/filename="(.+?)"/);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = match?.[1] ?? 'receipts.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({
        title: 'Could not download',
        description: e instanceof Error ? e.message : 'Something went wrong',
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  const filterParams = () => {
    const p = new URLSearchParams({ status: statusFilter });
    if (typeFilter !== 'ALL') p.set('type', typeFilter);
    if (search.trim()) p.set('search', search.trim());
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (dup) p.set('dup', dup);
    return p;
  };

  const { data, isLoading, isFetching } = useQuery<ReceiptsResponse>({
    queryKey: ['receipt-approvals', statusFilter, typeFilter, search, from, to, dup, page],
    queryFn: async () => {
      const p = filterParams();
      p.set('page', String(page));
      p.set('limit', '25');
      const r = await fetch(`/api/receipts?${p}`);
      if (!r.ok) throw new Error(`Failed to load receipts (HTTP ${r.status})`);
      return r.json();
    },
    placeholderData: (prev) => prev,
  });

  const receipts = (data?.receipts ?? []).filter((r) => !hiddenIds.has(r.id));
  const counts = data?.counts ?? { PENDING: 0, APPROVED: 0, DISAPPROVED: 0 };
  const dupCounts = data?.dupCounts ?? { unique: 0, duplicate: 0 };
  const totalPages = data?.totalPages ?? 1;
  const total = data?.total ?? 0;

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
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
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

        {/* Repeat-student scopes. Separate from status, so selecting one clears
            the status filter rather than intersecting with it. */}
        {([
          { key: 'unique' as const, label: 'Unique', color: 'text-sky-600', Icon: Users,
            hint: 'Same student, different colleges — a legitimate second application' },
          { key: 'duplicate' as const, label: 'Duplicate', color: 'text-orange-600', Icon: CopyIcon,
            hint: 'Same student, same college — likely entered twice' },
        ]).map((c) => (
          <button
            key={c.key}
            title={c.hint}
            onClick={() => {
              const next = dup === c.key ? null : c.key;
              setDup(next);
              if (next) setStatusFilter('ALL');
              setPage(1);
            }}
            className={cn(
              'rounded-xl border p-3 sm:p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm',
              dup === c.key ? 'border-primary/50 bg-primary/5 ring-1 ring-primary/20' : 'border-border/60 bg-card',
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
              <c.Icon className={cn('h-4 w-4', c.color)} />
            </div>
            <p className={cn('mt-1 text-2xl font-bold tabular-nums', c.color)}>{dupCounts[c.key]}</p>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border text-sm shrink-0">
          {STATUS_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => { setStatusFilter(t.key); setDup(null); setPage(1); }}
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
            placeholder="Search student, email, phone, receipt #, LID, lead code…"
            className="pl-9"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        {/* Paid-date range — the date the student paid, which is what the KPI
            and Caller-wise report count a receipt by. */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Input
            type="date"
            aria-label="Paid from"
            className="h-9 w-[150px]"
            value={from}
            max={to || undefined}
            onChange={(e) => { setFrom(e.target.value); setPage(1); }}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            aria-label="Paid to"
            className="h-9 w-[150px]"
            value={to}
            min={from || undefined}
            onChange={(e) => { setTo(e.target.value); setPage(1); }}
          />
          {(from || to) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2 text-xs"
              onClick={() => { setFrom(''); setTo(''); setPage(1); }}
            >
              Clear
            </Button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 gap-1.5"
          onClick={downloadCsv}
          disabled={downloading || total === 0}
          title={total === 0 ? 'Nothing to download for these filters' : `Download ${total} row(s) as CSV`}
        >
          {downloading
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Download className="h-3.5 w-3.5" />}
          {downloading ? 'Preparing…' : 'Download CSV'}
        </Button>
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
        <div className={cn('overflow-auto rounded-lg border border-border/60 transition-opacity duration-150', isFetching && 'opacity-60')}>
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 z-20">
              <tr className="border-b border-border/60 bg-muted">
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[110px]">Type</th>
                <th className="sticky left-0 z-30 bg-muted border-r border-border/60 whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[190px]">Student</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[130px]">Lead Code</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[160px]">Campus</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[160px]">Course</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-right text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[100px]">Amount</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[140px]">Receipt No.</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[110px]">Paid Date</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[120px]">Status</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[170px]">Uploaded By</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[170px]">Reviewed By</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[220px]">Disapproval Reason</th>
                <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[150px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {receipts.map((r) => {
                const t = TYPE_META[r.type];
                return (
                  <tr key={r.id} className="group border-b border-border/40 transition-colors last:border-0 hover:bg-muted/20">
                    {/* Type */}
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded', t.chip)}>
                          <Receipt className="h-3 w-3" />
                        </span>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold', t.badge)}>{t.label}</span>
                      </span>
                    </td>

                    {/* Student (sticky) — background MUST stay fully opaque (no
                        alpha), or scrolled-past columns bleed through on hover */}
                    <td className="sticky left-0 z-10 border-r border-border/60 bg-card px-3 py-2.5 transition-colors group-hover:bg-muted">
                      {r.lead ? (
                        <a
                          href={`/leads/${r.lead.id}/profile`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-sm font-semibold hover:text-primary hover:underline"
                        >
                          {r.studentName} <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-sm font-semibold">{r.studentName}</span>
                      )}
                      <p className="font-mono text-[10px] text-muted-foreground">{r.lead?.id}</p>
                    </td>

                    {/* The lead's own code, not the receipt's — it is what the
                        LMS reconciles a preferences push against, so finance
                        needs it beside the receipt number. */}
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs text-muted-foreground">
                      {r.lead?.campaign || '—'}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{r.campusName}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{r.courseName}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-right text-xs font-semibold tabular-nums">₹{r.amountPaid}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs text-muted-foreground">{r.receiptNumber}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.paidDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>

                    <td className="px-3 py-2.5 text-center">
                      <StatusBadge status={r.status} />
                    </td>

                    <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                      <span className="inline-flex items-center gap-1 font-medium text-foreground/80">
                        <UserRound className="h-3 w-3 shrink-0 text-muted-foreground" /> {r.uploadedBy.name}
                      </span>
                      <p className="text-[10px] text-muted-foreground">{formatDateTime(r.createdAt)}</p>
                    </td>

                    <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                      {r.reviewedBy ? (
                        <>
                          <span className="font-medium text-foreground/80">{r.reviewedBy.name}</span>
                          {r.reviewedAt && <p className="text-[10px] text-muted-foreground">{formatDateTime(r.reviewedAt)}</p>}
                        </>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>

                    <td className="max-w-[260px] whitespace-normal px-3 py-2.5 text-xs">
                      {r.status === 'DISAPPROVED' && r.disapprovalReason ? (
                        <span className="text-red-700 dark:text-red-400">{r.disapprovalReason}</span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="border-l border-border/60 px-3 py-2.5">
                      <div className="flex items-center justify-center gap-1.5">
                        <a
                          href={`/api/leads/${r.lead?.id}/receipts/${r.id}/file`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View Receipt"
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-input shadow-sm transition-colors hover:bg-muted/60"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                        {r.status === 'PENDING' && (
                          <>
                            <button
                              onClick={() => review(r, 'APPROVE')}
                              title="Approve"
                              className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-white transition-colors hover:bg-emerald-700"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={() => setDisapproveTarget(r)}
                              title="Disapprove"
                              className="flex h-7 w-7 items-center justify-center rounded-md border border-red-300/60 bg-red-500/10 text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-400"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
