'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, FileText, Image as ImageIcon, Loader2, Search, UploadCloud, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

export type ReceiptKind = 'APPLICATION' | 'ADMISSION';

interface StaticOption {
  id: number | string;
  name: string;
}

interface Option {
  value: string;
  label: string;
}

function toOptionsFromStatic(list: StaticOption[]): Option[] {
  return list.map((o) => ({ value: String(o.id), label: o.name }));
}

const INPUT_CLASS =
  'flex h-9 w-full items-center rounded-md border border-input bg-background px-3 text-[13px] text-foreground shadow-sm transition-all duration-150 placeholder:text-muted-foreground/60 hover:border-primary/40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';
const LABEL_CLASS = 'text-xs font-semibold text-foreground/80';
const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.pdf'];
const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// ─── Single-value searchable select ────────────────────────────────────────────

function SearchableSelect({
  options, value, onChange, placeholder, disabled,
}: {
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = !q ? options : options.filter((o) => o.label.toLowerCase().includes(q));
    return list.slice(0, 200);
  }, [options, query]);

  const label = options.find((o) => o.value === value)?.label;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          INPUT_CLASS, 'justify-between gap-2 cursor-pointer',
          disabled && 'cursor-not-allowed bg-muted/50 text-muted-foreground/90 hover:border-input'
        )}
      >
        <span className={cn('truncate text-left', !label && 'text-muted-foreground/60')}>
          {label ?? (placeholder ?? '— Select —')}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-lg overflow-hidden">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search…"
              className="flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/60"
            />
          </div>

          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
            )}
            {filtered.map((opt) => {
              const checked = opt.value === value;
              return (
                <li
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false); setQuery(''); }}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-muted/50"
                >
                  <span className={cn(
                    'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-input',
                    checked && 'border-primary bg-primary'
                  )}>
                    {checked && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function Field({ label, required, children, span2 }: { label: string; required?: boolean; children: React.ReactNode; span2?: boolean }) {
  return (
    <div className={cn('space-y-1.5', span2 && 'col-span-2')}>
      <label className={LABEL_CLASS}>
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
    </div>
  );
}

// ─── Form state ─────────────────────────────────────────────────────────────────

interface ReceiptFormState {
  campusId: string;
  couponCodeApplied: 'Yes' | 'No';
  referralCode: string;
  paidDate: string;
  receiptNumber: string;
  actualAmount: string;
  amountPaid: string;
  courseId: string;
  studentName: string;
  email: string;
  altEmail: string;
  mobile: string;
  altMobile: string;
  city: string;
  state: string;
}

function emptyForm(): ReceiptFormState {
  return {
    campusId: '', couponCodeApplied: 'No', referralCode: '', paidDate: '',
    receiptNumber: '', actualAmount: '', amountPaid: '', courseId: '',
    studentName: '', email: '', altEmail: '', mobile: '', altMobile: '',
    city: '', state: '',
  };
}

const COPY: Record<ReceiptKind, { title: string; dateLabel: string; numberLabel: string; amountLabel: string }> = {
  APPLICATION: {
    title: 'Application Receipt Upload',
    dateLabel: 'Application Form Paid Date',
    numberLabel: 'Application Form Number',
    amountLabel: 'Final Amount Paid',
  },
  ADMISSION: {
    title: 'Admission Receipt Upload',
    dateLabel: 'Admission Paid Date',
    numberLabel: 'Admission Number',
    amountLabel: 'Admission Amount Paid',
  },
};

export function ReceiptUploadDialog({
  leadId, kind, open, onOpenChange, agentName, lead,
}: {
  leadId: string;
  kind: ReceiptKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentName: string;
  lead?: { name?: string | null; email?: string | null; phone?: string | null; city?: string | null; state?: string | null } | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const copy = COPY[kind];

  const [form, setForm] = useState<ReceiptFormState>(emptyForm());
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Re-seed the form from the lead's known details each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setForm({
      ...emptyForm(),
      studentName: lead?.name ?? '',
      email: lead?.email ?? '',
      mobile: lead?.phone ?? '',
      city: lead?.city ?? '',
      state: lead?.state ?? '',
    });
    setFile(null);
    setFileError('');
  }, [open, lead]);

  // Campus Name is sourced from the Super Admin's "Manage Colleges" list
  // (DropdownOption type=COLLEGE) — not the external KollegeApply college API.
  const { data: manageCollegesData = [] } = useQuery<{ id: string; value: string }[]>({
    queryKey: ['dropdown-colleges'],
    queryFn: () => fetch('/api/dropdown-options?type=COLLEGE').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
    enabled: open,
  });
  const { data: coursesData = [] } = useQuery<StaticOption[]>({
    queryKey: ['static-courses'],
    queryFn: () => fetch('/api/courses').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
    enabled: open,
  });
  const { data: statesRaw } = useQuery<{ data?: { name: string }[] }>({
    queryKey: ['locations-state'],
    queryFn: () => fetch('/api/locations?type=state').then((r) => r.json()),
    staleTime: Infinity,
    enabled: open,
  });
  const { data: citiesRaw } = useQuery<{ data?: { city_name: string }[] }>({
    queryKey: ['locations-city'],
    queryFn: () => fetch('/api/locations?type=city').then((r) => r.json()),
    staleTime: Infinity,
    enabled: open,
  });

  const collegeOpts = useMemo<Option[]>(
    () => manageCollegesData.map((c) => ({ value: c.id, label: c.value })),
    [manageCollegesData]
  );
  const courseOpts = useMemo(() => toOptionsFromStatic(coursesData), [coursesData]);
  const stateOpts = useMemo<Option[]>(
    () => (statesRaw?.data ?? []).map((s) => ({ value: s.name, label: s.name })),
    [statesRaw]
  );
  const cityOpts = useMemo<Option[]>(
    () => (citiesRaw?.data ?? []).map((c) => ({ value: c.city_name, label: c.city_name })),
    [citiesRaw]
  );

  function patch(updates: Partial<ReceiptFormState>) {
    setForm((f) => ({ ...f, ...updates }));
  }

  function handleFileSelect(f: File | null) {
    if (!f) { setFile(null); setFileError(''); return; }
    const ext = '.' + (f.name.split('.').pop() ?? '').toLowerCase();
    if (!ALLOWED_MIME_TYPES.includes(f.type) || !ALLOWED_EXTENSIONS.includes(ext)) {
      setFile(null);
      setFileError('Only PNG, JPG, and PDF files are allowed');
      return;
    }
    if (f.size > MAX_FILE_SIZE) {
      setFile(null);
      setFileError('File exceeds the 10 MB size limit');
      return;
    }
    setFileError('');
    setFile(f);
  }

  const courseName = courseOpts.find((o) => o.value === form.courseId)?.label ?? '';
  const campusName = collegeOpts.find((o) => o.value === form.campusId)?.label ?? '';

  const missing: string[] = [];
  if (!form.campusId) missing.push('Campus Name');
  if (!form.paidDate) missing.push(copy.dateLabel);
  if (!form.receiptNumber.trim()) missing.push(copy.numberLabel);
  if (!form.amountPaid.trim()) missing.push(copy.amountLabel);
  if (!form.courseId) missing.push('Course');
  if (!form.studentName.trim()) missing.push('Student Name');
  if (!form.email.trim()) missing.push('Email');
  if (!form.mobile.trim()) missing.push('Mobile Number');
  if (!form.state) missing.push('State');
  if (!file) missing.push('Receipt File');

  const uploadMutation = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set('type', kind);
      fd.set('campusName', campusName);
      fd.set('couponCodeApplied', form.couponCodeApplied);
      fd.set('referralCode', form.couponCodeApplied === 'Yes' ? form.referralCode : '');
      fd.set('paidDate', form.paidDate);
      fd.set('receiptNumber', form.receiptNumber.trim());
      fd.set('actualAmount', form.actualAmount.trim());
      fd.set('amountPaid', form.amountPaid.trim());
      fd.set('courseId', form.courseId);
      fd.set('courseName', courseName);
      fd.set('studentName', form.studentName.trim());
      fd.set('email', form.email.trim());
      fd.set('altEmail', form.altEmail.trim());
      fd.set('mobile', form.mobile.trim());
      fd.set('altMobile', form.altMobile.trim());
      fd.set('city', form.city);
      fd.set('state', form.state);
      if (file) fd.set('file', file);

      const res = await fetch(`/api/leads/${leadId}/receipts`, { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to upload receipt');
      return json;
    },
    onSuccess: () => {
      toast({ title: `${copy.title} successful` });
      qc.invalidateQueries({ queryKey: ['lead-receipts', leadId] });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Upload failed', description: err.message });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            Fill in the receipt details and attach the receipt file (PNG, JPG, or PDF).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
          <Field label="Campus Name" required>
            <SearchableSelect options={collegeOpts} value={form.campusId}
              onChange={(v) => patch({ campusId: v })} placeholder="— Select Campus —" />
          </Field>

          <Field label="Coupon Code Applied">
            <select
              className={INPUT_CLASS}
              value={form.couponCodeApplied}
              onChange={(e) => patch({ couponCodeApplied: e.target.value as 'Yes' | 'No', referralCode: e.target.value === 'No' ? '' : form.referralCode })}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </Field>

          {form.couponCodeApplied === 'Yes' && (
            <Field label="Referral Code">
              <input className={INPUT_CLASS} placeholder="Referral code" value={form.referralCode}
                onChange={(e) => patch({ referralCode: e.target.value })} />
            </Field>
          )}

          <Field label={copy.dateLabel} required>
            <input type="date" className={INPUT_CLASS} value={form.paidDate}
              onChange={(e) => patch({ paidDate: e.target.value })} />
          </Field>

          <Field label={copy.numberLabel} required>
            <input className={INPUT_CLASS} placeholder={copy.numberLabel} value={form.receiptNumber}
              onChange={(e) => patch({ receiptNumber: e.target.value })} />
          </Field>

          <Field label="Actual Amount of Form">
            <input className={INPUT_CLASS} placeholder="₹" inputMode="decimal" value={form.actualAmount}
              onChange={(e) => patch({ actualAmount: e.target.value })} />
          </Field>

          <Field label={copy.amountLabel} required>
            <input className={INPUT_CLASS} placeholder="₹" inputMode="decimal" value={form.amountPaid}
              onChange={(e) => patch({ amountPaid: e.target.value })} />
          </Field>

          <Field label="Course" required>
            <SearchableSelect options={courseOpts} value={form.courseId}
              onChange={(v) => patch({ courseId: v })} placeholder="— Select Course —" />
          </Field>

          <Field label="Student Name" required>
            <input className={INPUT_CLASS} placeholder="Student name" value={form.studentName}
              onChange={(e) => patch({ studentName: e.target.value })} />
          </Field>

          <Field label="Email" required>
            <input type="email" className={INPUT_CLASS} placeholder="email@example.com" value={form.email}
              onChange={(e) => patch({ email: e.target.value })} />
          </Field>

          <Field label="Alternate Email">
            <input type="email" className={INPUT_CLASS} placeholder="email@example.com" value={form.altEmail}
              onChange={(e) => patch({ altEmail: e.target.value })} />
          </Field>

          <Field label="Mobile Number" required>
            <input className={INPUT_CLASS} placeholder="10-digit number" value={form.mobile}
              onChange={(e) => patch({ mobile: e.target.value })} />
          </Field>

          <Field label="Alternate Contact Number">
            <input className={INPUT_CLASS} placeholder="10-digit number" value={form.altMobile}
              onChange={(e) => patch({ altMobile: e.target.value })} />
          </Field>

          <Field label="City">
            <SearchableSelect options={cityOpts} value={form.city}
              onChange={(v) => patch({ city: v })} placeholder="— Select City —" />
          </Field>

          <Field label="State" required>
            <SearchableSelect options={stateOpts} value={form.state}
              onChange={(v) => patch({ state: v })} placeholder="— Select State —" />
          </Field>

          <Field label="Form Owner Agent">
            <div className="flex h-9 w-full items-center rounded-md border border-border bg-muted/50 px-3 text-[13px] text-muted-foreground/90">
              {agentName}
            </div>
          </Field>

          <Field label="Receipt File" required span2>
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.pdf,image/png,image/jpeg,application/pdf"
              className="hidden"
              onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
            />
            {!file ? (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center gap-1.5 rounded-md border-2 border-dashed border-input bg-muted/20 px-4 py-5 text-center transition-colors hover:border-primary/40 hover:bg-primary/5"
              >
                <UploadCloud className="h-5 w-5 text-muted-foreground/70" />
                <span className="text-xs font-medium text-foreground/80">Click to attach receipt</span>
                <span className="text-[11px] text-muted-foreground">PNG, JPG, or PDF — up to 10 MB</span>
              </button>
            ) : (
              <div className="flex items-center gap-2.5 rounded-md border border-border bg-muted/30 px-3 py-2">
                {file.type === 'application/pdf'
                  ? <FileText className="h-4 w-4 shrink-0 text-primary" />
                  : <ImageIcon className="h-4 w-4 shrink-0 text-primary" />}
                <span className="flex-1 truncate text-[13px]">{file.name}</span>
                <span className="text-[11px] text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
                <button type="button" onClick={() => handleFileSelect(null)} className="text-muted-foreground hover:text-destructive">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            {fileError && <p className="text-[11px] font-medium text-destructive">{fileError}</p>}
          </Field>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-lg border border-input px-4 py-2 text-sm font-semibold shadow-sm transition-all duration-150 hover:bg-muted/50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={missing.length > 0 || uploadMutation.isPending}
            title={missing.length > 0 ? `Missing: ${missing.join(', ')}` : undefined}
            onClick={() => uploadMutation.mutate()}
            className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.98] disabled:opacity-50"
          >
            {uploadMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Upload Receipt
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
