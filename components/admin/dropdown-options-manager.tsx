'use client';

import { useRef, useState } from 'react';
import Papa from 'papaparse';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import {
  Plus, Pencil, Trash2, Loader2, ListChecks, Tag, ShieldCheck, Globe2,
  GraduationCap, MapPin, PhoneCall, CheckCircle2, Layers, Inbox, Handshake, Link2, Hash,
  Upload, FileDown, AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { COLLEGE_ZONES, COLLEGE_DEAL_TYPES, COLLEGE_CLIENT_TYPES } from '@/lib/college-attributes';
import { AGENT_TOKEN, checkLandingPageUrl, hasAgentToken, resolveLandingPageUrl } from '@/lib/landing-page';
import { useUndoable } from '@/components/shared/use-undoable';

const TYPE_META: Record<string, { icon: React.ComponentType<{ className?: string }>; color: string; bg: string; ring: string }> = {
  LEAD_TYPE:          { icon: Tag,           color: 'text-indigo-600 dark:text-indigo-400', bg: 'bg-indigo-500/10',  ring: 'from-indigo-500 to-indigo-600' },
  LEAD_VERIFICATION:  { icon: ShieldCheck,   color: 'text-blue-600 dark:text-blue-400',      bg: 'bg-blue-500/10',    ring: 'from-blue-500 to-blue-600' },
  LEAD_ORIGIN:        { icon: Globe2,        color: 'text-cyan-600 dark:text-cyan-400',      bg: 'bg-cyan-500/10',    ring: 'from-cyan-500 to-cyan-600' },
  COLLEGE:            { icon: GraduationCap, color: 'text-violet-600 dark:text-violet-400',  bg: 'bg-violet-500/10',  ring: 'from-violet-500 to-violet-600' },
  ZONE:               { icon: MapPin,        color: 'text-rose-600 dark:text-rose-400',      bg: 'bg-rose-500/10',    ring: 'from-rose-500 to-rose-600' },
  DATA_CALLING_TYPE:  { icon: PhoneCall,     color: 'text-amber-600 dark:text-amber-400',    bg: 'bg-amber-500/10',   ring: 'from-amber-500 to-amber-600' },
  LEAD_CONFIRMATION:  { icon: CheckCircle2,  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', ring: 'from-emerald-500 to-emerald-600' },
  LEAD_STAGE:         { icon: Layers,        color: 'text-slate-600 dark:text-slate-400',    bg: 'bg-slate-500/10',   ring: 'from-slate-500 to-slate-600' },
  DEAL_TYPE:          { icon: Handshake,     color: 'text-pink-600 dark:text-pink-400',      bg: 'bg-pink-500/10',    ring: 'from-pink-500 to-pink-600' },
  LEAD_CODE:          { icon: Hash,          color: 'text-teal-600 dark:text-teal-400',      bg: 'bg-teal-500/10',    ring: 'from-teal-500 to-teal-600' },
};
// Matches components/ui/input.tsx so a select sits flush with the text fields
// above it in the same dialog.
const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-all duration-200 hover:border-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50';

/** The input's current selection, or a plain caret when nothing is highlighted. */
function rangeOf(el: HTMLInputElement): { start: number; end: number } {
  const start = el.selectionStart ?? el.value.length;
  return { start, end: el.selectionEnd ?? start };
}

const DEFAULT_META = { icon: ListChecks, color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-500/10', ring: 'from-slate-500 to-slate-600' };

interface DropdownOption {
  id: string;
  type: string;
  value: string;
  kappCollegeId?: string | null;
  collegeZone?: string | null;
  collegeDealType?: string | null;
  collegeClientType?: string | null;
  collegeSessionYear?: string | null;
  landingPageUrl?: string | null;
  leadCodeCallingType?: string | null;
  isActive: boolean;
  createdAt: string;
}

interface ImportResult {
  created: number;
  updated: number;
  /** Leads whose Data Calling Type actually changed as a result. */
  leadsUpdated: number;
  /** A lead code listed more than once in the file; the last row won. */
  duplicatesInFile: number;
  rejected: number;
  errors: { row: number; leadCode: string; reason: string }[];
}

interface IdField {
  label: string;
  placeholder: string;
}

interface Props {
  type: string;
  title: string;
  description: string;
  placeholder?: string;
  idField?: IdField; // extra required ID field (used for colleges)
  // Colleges also carry the Zone and Deal Type that every lead ingested for
  // them inherits, so those are configured here rather than per lead.
  collegeAttributes?: boolean;
  // Lead codes carry the Data Calling Type every lead with that code takes.
  // The choices come from the Data Calling Type list, so the two can never
  // disagree about what is a legal value.
  leadCodeMapping?: boolean;
}

export function DropdownOptionsManager({ type, title, description, placeholder, idField, collegeAttributes, leadCodeMapping }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();

  const undoable = useUndoable();
  // Optimistically hidden while their undo toast is open (Gmail-style delete)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const [showDialog, setShowDialog]     = useState(false);
  const [editOption, setEditOption]     = useState<DropdownOption | null>(null);
  const [value, setValue]               = useState('');
  const [kappCollegeId, setKappId]      = useState('');
  const [collegeZone, setCollegeZone]         = useState('');
  const [collegeDealType, setCollegeDealType] = useState('');
  const [collegeClientType, setCollegeClientType] = useState('');
  const [collegeSessionYear, setCollegeSessionYear] = useState('');
  const [landingPageUrl, setLandingPageUrl]   = useState('');
  const [callingType, setCallingType]         = useState('');
  const [importOpen, setImportOpen]           = useState(false);
  const [importBusy, setImportBusy]           = useState(false);
  const [importResult, setImportResult]       = useState<ImportResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const landingInputRef = useRef<HTMLInputElement>(null);
  // Where the {{%agent%}} chip inserts. Tracked rather than read on demand
  // because an input that has never been focused reports a caret at position 0,
  // which would put the token in front of "https://" instead of after it.
  // Both ends are kept so that highlighted text is replaced rather than
  // straddled, which is what every other text field does.
  const landingCaretRef = useRef<{ start: number; end: number } | null>(null);

  const queryKey = ['dropdown-options', type];

  const { data: options = [], isLoading } = useQuery<DropdownOption[]>({
    queryKey,
    queryFn: () =>
      fetch(`/api/dropdown-options?type=${type}&all=1`).then(async (r) => {
        const d = await r.json();
        return Array.isArray(d) ? d : [];
      }),
    enabled: !!session?.user?.id,
  });

  // Only fetched for the lead-code screen; every other dropdown manager pays
  // nothing for this.
  const { data: callingTypes = [] } = useQuery<DropdownOption[]>({
    queryKey: ['dropdown-options', 'DATA_CALLING_TYPE'],
    queryFn: () =>
      fetch('/api/dropdown-options?type=DATA_CALLING_TYPE').then(async (r) => {
        const d = await r.json();
        return Array.isArray(d) ? d : [];
      }),
    enabled: !!leadCodeMapping && !!session?.user?.id,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey });
    // A saved mapping rewrites leads, so anything showing them is now stale.
    if (leadCodeMapping) qc.invalidateQueries({ queryKey: ['all-leads'] });
  };

  const openCreate = () => {
    setEditOption(null);
    setValue('');
    setKappId('');
    setCollegeZone('');
    setCollegeDealType('');
    // Both of these were missing: Client Type was never cleared here, so after
    // editing a college that had one set, "Add Value" opened with that value
    // still selected and it was saved onto the new college. Session/Year would
    // have inherited the same leak.
    setCollegeClientType('');
    setCollegeSessionYear('');
    setLandingPageUrl('');
    setCallingType('');
    landingCaretRef.current = null;
    setShowDialog(true);
  };

  const openEdit = (opt: DropdownOption) => {
    setEditOption(opt);
    setValue(opt.value);
    setKappId(opt.kappCollegeId ?? '');
    setCollegeZone(opt.collegeZone ?? '');
    setCollegeDealType(opt.collegeDealType ?? '');
    setCollegeClientType(opt.collegeClientType ?? '');
    setCollegeSessionYear(opt.collegeSessionYear ?? '');
    setLandingPageUrl(opt.landingPageUrl ?? '');
    setCallingType(opt.leadCodeCallingType ?? '');
    landingCaretRef.current = null;
    setShowDialog(true);
  };

  // Checked as the admin types so a malformed link is caught before saving,
  // using the same function the API validates with — the two cannot disagree.
  const landingCheck = collegeAttributes ? checkLandingPageUrl(landingPageUrl) : { ok: true as const };
  const canSave =
    value.trim() !== '' && (!idField || kappCollegeId.trim() !== '') && landingCheck.ok
    // A lead code with no Data Calling Type would sit there doing nothing.
    && (!leadCodeMapping || callingType !== '');

  /**
   * Drops the token in at the caret, or at the end if the admin has not put a
   * cursor anywhere yet. Blind appending was worse than it looks: on a URL
   * ending `…&utm_campaign=2027` it produced `2027{{%agent%}}`, which resolves
   * to `2027019` — a corrupted campaign value rather than an agent tag.
   */
  const insertAgentToken = () => {
    const sel = landingCaretRef.current;
    const start = sel?.start ?? landingPageUrl.length;
    const end = sel?.end ?? start;
    const next = landingPageUrl.slice(0, start) + AGENT_TOKEN + landingPageUrl.slice(end);
    const caret = start + AGENT_TOKEN.length;
    landingCaretRef.current = { start: caret, end: caret };
    setLandingPageUrl(next);
    // After React has painted the new value, or setSelectionRange would run
    // against the old one and the cursor would jump.
    requestAnimationFrame(() => {
      landingInputRef.current?.focus();
      landingInputRef.current?.setSelectionRange(caret, caret);
    });
  };

  /**
   * Parses the file in the browser, the same way the leads upload does, and
   * posts rows. Header spellings are normalised so "Lead Code" and "lead_code"
   * both work — an admin should not have to guess the casing.
   */
  async function runImport(file: File) {
    setImportBusy(true);
    setImportResult(null);
    try {
      const rows = await new Promise<{ leadCode: string; dataCallingType: string }[]>((resolve, reject) => {
        Papa.parse<Record<string, string>>(file, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim().toLowerCase().replace(/\s+/g, '_'),
          complete: (res) => {
            if (res.errors.length > 0) return reject(new Error(res.errors[0].message));
            resolve(res.data.map((r) => ({
              leadCode: (r.lead_code ?? r.leadcode ?? r.code ?? '').trim(),
              dataCallingType: (r.data_calling_type ?? r.datacallingtype ?? r.calling_type ?? '').trim(),
            })).filter((r) => r.leadCode || r.dataCallingType));
          },
          error: (e) => reject(e),
        });
      });
      if (rows.length === 0) throw new Error('No rows found. Expected columns: lead_code, data_calling_type');

      const r = await fetch('/api/dropdown-options/lead-codes/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? 'Import failed');
      setImportResult(d as ImportResult);
      invalidate();
    } catch (err) {
      toast({ variant: 'destructive', title: 'Import failed', description: (err as Error).message });
    } finally {
      setImportBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editOption) {
        const body: Record<string, unknown> = { value: value.trim() };
        if (idField) body.kappCollegeId = kappCollegeId.trim();
        if (collegeAttributes) {
          body.collegeZone = collegeZone.trim();
          body.collegeDealType = collegeDealType.trim();
          body.collegeClientType = collegeClientType.trim();
          body.collegeSessionYear = collegeSessionYear.trim();
          body.landingPageUrl = landingPageUrl.trim();
        }
        if (leadCodeMapping) body.leadCodeCallingType = callingType;
        const r = await fetch(`/api/dropdown-options/${editOption.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Failed to update');
        return d as { leadsUpdated?: number };
      } else {
        const body: Record<string, unknown> = { type, value: value.trim() };
        if (idField) body.kappCollegeId = kappCollegeId.trim();
        if (collegeAttributes) {
          body.collegeZone = collegeZone.trim();
          body.collegeDealType = collegeDealType.trim();
          body.collegeClientType = collegeClientType.trim();
          body.collegeSessionYear = collegeSessionYear.trim();
          body.landingPageUrl = landingPageUrl.trim();
        }
        if (leadCodeMapping) body.leadCodeCallingType = callingType;
        const r = await fetch('/api/dropdown-options', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? 'Failed to create');
        return d as { leadsUpdated?: number };
      }
    },
    onSuccess: (res) => {
      const n = res?.leadsUpdated ?? 0;
      toast({
        title: editOption ? 'Option updated' : 'Option added',
        // Saying nothing after rewriting thousands of leads is how a tool loses
        // trust. Silent when it changed nothing, which is the common case.
        description: n > 0
          ? `${n.toLocaleString('en-IN')} lead${n === 1 ? '' : 's'} now show ${callingType}.`
          : undefined,
      });
      setShowDialog(false);
      invalidate();
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (opt: DropdownOption) =>
      fetch(`/api/dropdown-options/${opt.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !opt.isActive }),
      }).then((r) => r.json()),
    onSuccess: () => { toast({ title: 'Status updated' }); invalidate(); },
    onError: () => toast({ variant: 'destructive', title: 'Failed to update status' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/dropdown-options/${id}`, { method: 'DELETE' }).then((r) => r.json()),
    onSuccess: () => { toast({ title: 'Option deleted' }); invalidate(); },
    onError: () => toast({ variant: 'destructive', title: 'Failed to delete option' }),
  });

  const visibleOptions = options.filter((o) => !hiddenIds.has(o.id));
  const activeCount   = visibleOptions.filter((o) => o.isActive).length;
  const inactiveCount = visibleOptions.length - activeCount;
  const meta = TYPE_META[type] ?? DEFAULT_META;
  const Icon = meta.icon;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 animate-fade-in-up">
        <div className="flex items-start gap-3.5">
          <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br shadow-lg', meta.ring)}>
            <Icon className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {leadCodeMapping && (
            <Button variant="outline" onClick={() => { setImportResult(null); setImportOpen(true); }}>
              <Upload className="mr-2 h-4 w-4" />
              Upload CSV
            </Button>
          )}
          <Button
            onClick={openCreate}
            className="shadow-md shadow-primary/20 transition-transform duration-200 ease-premium hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/30"
          >
            <Plus className="mr-2 h-4 w-4" />
            Add Value
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 animate-fade-in-up" style={{ animationDelay: '60ms' }}>
        <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-card px-4 py-3 hover-lift">
          <div className={cn('pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100', meta.bg)} />
          <p className="relative text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
          <p className="relative mt-0.5 text-2xl font-bold tabular-nums">{visibleOptions.length}</p>
        </div>
        <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-card px-4 py-3 hover-lift">
          <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-emerald-500/10 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
          <p className="relative text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Active</p>
          <p className="relative mt-0.5 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{activeCount}</p>
        </div>
        {inactiveCount > 0 && (
          <div className="group relative overflow-hidden rounded-xl border border-border/60 bg-card px-4 py-3 hover-lift">
            <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-muted opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
            <p className="relative text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Inactive</p>
            <p className="relative mt-0.5 text-2xl font-bold tabular-nums text-muted-foreground">{inactiveCount}</p>
          </div>
        )}
      </div>

      {/* List */}
      <div className="rounded-2xl border border-border/60 bg-card shadow-sm animate-fade-in-up" style={{ animationDelay: '120ms' }}>
        <div className="flex items-center gap-2 border-b border-border/60 px-6 py-4">
          <Layers className="h-4 w-4 text-muted-foreground" />
          <div>
            <p className="text-sm font-bold leading-tight">Values</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Only <strong className="text-foreground">active</strong> values are accepted during CSV upload — inactive values are preserved for historical data.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-14">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : visibleOptions.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 py-14 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted">
              <Inbox className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">
              No values added yet. Click <strong className="text-foreground">&ldquo;Add Value&rdquo;</strong> to get started.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            <AnimatePresence initial={false}>
              {visibleOptions.map((opt, idx) => (
                <motion.div
                  key={opt.id}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(idx, 12) * 0.02 }}
                  className={cn(
                    'group flex items-center gap-3.5 px-6 py-3.5 transition-colors hover:bg-muted/30',
                    !opt.isActive && 'opacity-60',
                  )}
                >
                  {/* Initial avatar */}
                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold', meta.bg, meta.color)}>
                    {opt.value.trim().charAt(0).toUpperCase() || '?'}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className={cn('font-semibold truncate', !opt.isActive && 'line-through text-muted-foreground')}>
                      {opt.value}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      {idField && opt.kappCollegeId && (
                        <p className="text-[11px] text-muted-foreground">
                          {idField.label}: <span className="font-mono">{opt.kappCollegeId}</span>
                        </p>
                      )}
                      {/* Essential once a college can exist once per intake: two
                          rows may share a name and a KAPP ID, and the year is
                          the only thing telling them apart. */}
                      {opt.collegeSessionYear && (
                        <p className="text-[11px] text-muted-foreground">
                          Session/Year: <span className="font-semibold text-foreground">{opt.collegeSessionYear}</span>
                        </p>
                      )}
                      {opt.landingPageUrl && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                          <Link2 className="h-3 w-3" />
                          Landing page
                        </span>
                      )}
                      {opt.leadCodeCallingType && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          Data Calling Type:{' '}
                          <span className="font-semibold text-foreground">{opt.leadCodeCallingType}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <span
                    className={cn(
                      'hidden shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide sm:inline-flex',
                      opt.isActive
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'border-border bg-muted text-muted-foreground',
                    )}
                  >
                    <span className={cn('h-1.5 w-1.5 rounded-full', opt.isActive ? 'bg-emerald-500' : 'bg-muted-foreground/50')} />
                    {opt.isActive ? 'Active' : 'Inactive'}
                  </span>

                  <Switch
                    checked={opt.isActive}
                    onCheckedChange={() => toggleMutation.mutate(opt)}
                    title={opt.isActive ? 'Deactivate' : 'Activate'}
                    className="shrink-0"
                  />

                  <div className="flex items-center gap-0.5 shrink-0 rounded-lg border border-border/60 bg-muted/30 p-0.5">
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 hover:bg-background"
                      onClick={() => openEdit(opt)}
                      title="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost" size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => {
                        setHiddenIds((s) => new Set(s).add(opt.id));
                        undoable({
                          title: `Deleted "${opt.value}"`,
                          onExecute: () => deleteMutation.mutate(opt.id),
                          onUndo: () => setHiddenIds((s) => { const n = new Set(s); n.delete(opt.id); return n; }),
                        });
                      }}
                      title="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Bulk import — lead codes only */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upload lead codes</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!importResult && (
              <>
                <div className="rounded-lg border border-border/60 bg-muted/40 p-3">
                  <p className="text-xs font-semibold">Two columns, header row included</p>
                  <pre className="mt-2 overflow-x-auto rounded bg-background p-2 font-mono text-[11px] leading-relaxed">{`lead_code,data_calling_type
CKT200,${callingTypes[0]?.value ?? 'L1'}
BM101,${callingTypes[1]?.value ?? callingTypes[0]?.value ?? 'L2'}`}</pre>
                  <button
                    type="button"
                    onClick={() => {
                      const sample = `lead_code,data_calling_type\nCKT200,${callingTypes[0]?.value ?? ''}\n`;
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(new Blob([sample], { type: 'text/csv' }));
                      a.download = 'lead_codes_template.csv';
                      a.click();
                      URL.revokeObjectURL(a.href);
                    }}
                    className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    <FileDown className="h-3 w-3" /> Download template
                  </button>
                </div>

                <p className="text-[11px] text-muted-foreground">
                  Every <span className="font-semibold">data_calling_type</span> must be one of{' '}
                  <span className="font-semibold text-foreground">
                    {callingTypes.map((t) => t.value).join(', ') || '(none configured yet)'}
                  </span>
                  . Rows with anything else are listed back to you and skipped — nothing partial is
                  written for them. Capitalisation does not matter, for the type or the lead code.
                  A code already in the list is updated rather than duplicated.
                </p>

                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,text/csv"
                  disabled={importBusy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) runImport(f); }}
                  className="block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-xs file:font-medium file:text-primary-foreground hover:file:bg-primary/90"
                />
                {importBusy && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Importing and updating leads…
                  </p>
                )}
              </>
            )}

            {importResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Added', value: importResult.created },
                    { label: 'Updated', value: importResult.updated },
                    { label: 'Skipped', value: importResult.rejected },
                  ].map((c) => (
                    <div key={c.label} className="rounded-lg border border-border/60 bg-card px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{c.label}</p>
                      <p className="mt-0.5 text-xl font-bold tabular-nums">{c.value}</p>
                    </div>
                  ))}
                </div>
                <p className="text-xs">
                  <span className="font-semibold">{importResult.leadsUpdated.toLocaleString('en-IN')}</span>{' '}
                  lead{importResult.leadsUpdated === 1 ? '' : 's'} now show their mapped Data Calling Type.
                </p>
                {importResult.duplicatesInFile > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {importResult.duplicatesInFile} row{importResult.duplicatesInFile === 1 ? ' was' : 's were'} a
                    repeat of a lead code earlier in the file — the last one won.
                  </p>
                )}
                {importResult.errors.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5">
                    <p className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> Skipped rows
                    </p>
                    <ul className="mt-1.5 max-h-40 space-y-1 overflow-y-auto">
                      {importResult.errors.map((e, i) => (
                        <li key={i} className="text-[11px] text-muted-foreground">
                          Row {e.row} <span className="font-mono">{e.leadCode}</span> — {e.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              {importResult ? 'Done' : 'Cancel'}
            </Button>
            {importResult && (
              <Button onClick={() => setImportResult(null)}>Upload another</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editOption ? 'Edit Value' : `Add Value — ${title}`}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {idField && (
              <div className="space-y-1.5">
                <Label htmlFor="opt-kapp-id">
                  {idField.label} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="opt-kapp-id"
                  value={kappCollegeId}
                  onChange={(e) => setKappId(e.target.value)}
                  placeholder={idField.placeholder}
                  autoFocus
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="opt-value">Value <span className="text-destructive">*</span></Label>
              <Input
                id="opt-value"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={placeholder ?? `Enter ${title.toLowerCase()} value`}
                autoFocus={!idField}
              />
            </div>
            {leadCodeMapping && (
              <div className="space-y-1.5">
                <Label htmlFor="opt-calling-type">
                  Data Calling Type <span className="text-destructive">*</span>
                </Label>
                <select
                  id="opt-calling-type"
                  value={callingType}
                  onChange={(e) => setCallingType(e.target.value)}
                  className={SELECT_CLASS}
                >
                  <option value="">— Choose —</option>
                  {callingTypes.map((t) => (
                    <option key={t.id} value={t.value}>{t.value}</option>
                  ))}
                </select>
                {callingTypes.length === 0 ? (
                  <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                    No active Data Calling Types exist yet — add one under Manage Dropdowns → Data
                    Calling Type first.
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    Every lead carrying this lead code will show this Data Calling Type, replacing
                    whatever it had. The change is applied as soon as you save, and matching ignores
                    capitalisation — a mapping for <span className="font-mono">KCLL</span> also
                    covers <span className="font-mono">Kcll</span>.
                  </p>
                )}
              </div>
            )}

            {collegeAttributes && (
              <>
                {/* Fixed lists from lib/college-attributes.ts — the same source
                    the API validates against, so the two cannot drift. The blank
                    option is how an admin clears a value back to "not set". */}
                <div className="space-y-1.5">
                  <Label htmlFor="opt-college-zone">College Zone</Label>
                  <select
                    id="opt-college-zone"
                    value={collegeZone}
                    onChange={(e) => setCollegeZone(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">— Not set —</option>
                    {COLLEGE_ZONES.map((z) => (
                      <option key={z} value={z}>{z}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="opt-college-deal-type">Deal Type</Label>
                  <select
                    id="opt-college-deal-type"
                    value={collegeDealType}
                    onChange={(e) => setCollegeDealType(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">— Not set —</option>
                    {COLLEGE_DEAL_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="opt-college-client-type">Client Type</Label>
                  <select
                    id="opt-college-client-type"
                    value={collegeClientType}
                    onChange={(e) => setCollegeClientType(e.target.value)}
                    className={SELECT_CLASS}
                  >
                    <option value="">— Not set —</option>
                    {COLLEGE_CLIENT_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="opt-college-session-year">Session/Year</Label>
                  <Input
                    id="opt-college-session-year"
                    value={collegeSessionYear}
                    onChange={(e) => setCollegeSessionYear(e.target.value)}
                    placeholder="e.g. 2027"
                    maxLength={20}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Every lead brought in for this college — by API or CSV — inherits
                  this Zone and Deal Type. Choose “Not set” to leave them empty.
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Client Type and Session/Year behave differently: All Leads reads them
                  from the college each time, so setting one now updates every existing
                  lead for this college, not just new ones. Leads for a college with
                  none set read “NA”.
                </p>

                <div className="space-y-1.5 border-t border-border/60 pt-4">
                  <Label htmlFor="opt-landing-page">Landing Page Link</Label>
                  <Input
                    id="opt-landing-page"
                    ref={landingInputRef}
                    value={landingPageUrl}
                    onChange={(e) => {
                      setLandingPageUrl(e.target.value);
                      landingCaretRef.current = rangeOf(e.target);
                    }}
                    onSelect={(e) => { landingCaretRef.current = rangeOf(e.currentTarget); }}
                    placeholder={`https://apply.college.edu/?utm_medium=kcll_${AGENT_TOKEN}`}
                    spellCheck={false}
                    className={cn('font-mono text-xs', !landingCheck.ok && 'border-destructive focus-visible:ring-destructive')}
                  />

                  {!landingCheck.ok ? (
                    <p className="text-[11px] font-medium text-destructive">{landingCheck.error}</p>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Paste the college’s application link. Put{' '}
                      <button
                        type="button"
                        onClick={insertAgentToken}
                        // Keeps the caret where the admin put it: without this
                        // the button takes focus on mousedown and the input's
                        // selection is gone before the click handler runs.
                        onMouseDown={(e) => e.preventDefault()}
                        className="rounded bg-primary/10 px-1 py-0.5 font-mono font-semibold text-primary transition-colors hover:bg-primary/20"
                        title="Insert this token at the cursor"
                      >
                        {AGENT_TOKEN}
                      </button>{' '}
                      where the agent’s ID belongs — each agent sees their own ID
                      there, so the college can tell who sent the student.
                    </p>
                  )}

                  {/* Shown with a sample ID rather than the admin's own: this
                      link is configured once for the whole floor, so what
                      matters is the shape, not who is looking at it. */}
                  {landingCheck.ok && landingPageUrl.trim() !== '' && (
                    <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {hasAgentToken(landingPageUrl) ? 'An agent with ID 019 would share' : 'Agents would share'}
                      </p>
                      <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-foreground">
                        {resolveLandingPageUrl(landingPageUrl.trim(), '019')}
                      </p>
                      {!hasAgentToken(landingPageUrl) && (
                        <p className="mt-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                          No {AGENT_TOKEN} in this link — every agent shares the
                          same URL and the college cannot tell them apart.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!canSave || saveMutation.isPending}
            >
              {saveMutation.isPending && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {editOption ? 'Save Changes' : 'Add Value'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
