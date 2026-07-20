'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSession } from 'next-auth/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  X, Phone, Mail, PhoneCall, CalendarClock, PhoneIncoming,
  LayoutList, CheckCircle2, Loader2, PlusCircle, UserCheck,
  UserCircle2, ChevronDown, Search, Check, ExternalLink,
  GitBranch, UserPlus, FileCheck, Receipt, Clock3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { triggerCelebration, isCelebrationFeedback } from '@/lib/celebrate';
import { WhatsAppButton } from '@/components/shared/whatsapp-button';
import { computeProfilingScore, profilingScoreTone } from '@/lib/lead-profiling';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FeedbackOptionItem {
  id: string;
  label: string;
  description?: string | null;
}

interface Feedback {
  id: string;
  followUpNumber: number;
  remarks?: string | null;
  createdAt: string;
  agent: { id: string; name: string };
  feedbackOption: { id: string; label: string };
}

interface LeadProfile {
  id: string;
  budget?: string | null;
  preferredCourseIds?: number[] | null;
  preferredCollegeIds?: number[] | null;
  preferredCityNames?: string[] | null;
  preferredStateNames?: string[] | null;
  courseType?: string | null;
  collegeType?: string | null;
  specialisation?: string | null;
  entranceExam?: string[] | null;
  scholarshipAwareness?: string | null;
  loanRequirement?: string | null;
  loanAmount?: string | null;
  paymentModePreference?: string | null;
  stayPreference?: string | null;
  monthlyAccommodationBudget?: string | null;
  roomSharing?: string | null;
  mealsPreference?: string | null;
  keyAmenities?: string[] | null;
  distanceWillingness?: string | null;
  genderHostelRequirement?: string | null;
  class10Percentage?: string | null;
  class12Percentage?: string | null;
  board?: string | null;
  gapYearReason?: string | null;
  mediumOfInstruction?: string | null;
}

interface LeadDetail {
  id: string;
  name: string;
  email: string;
  phone: string;
  city?: string | null;
  state?: string | null;
  course?: string | null;
  college?: string | null;
  campaign?: string | null;
  leadType?: string | null;
  leadOrigin?: string | null;
  leadZone?: string | null;
  primaryApplicationConfirm?: string | null;
  primaryAdmissionConfirm?: string | null;
  leadConfirmation?: string | null;
  leadStage?: string | null;
  leadVerification?: string | null;
  dataCallingType?: string | null;
  status: string;
  createdAt: string;
  uploadedBy?: { name: string };
  assignedTo?:    { name: string } | null;
  assignedBy?:    { name: string } | null;
  assignedFrom?:  { name: string } | null;
  prevAssignee2?: { name: string } | null;
  altEmail1?:   string | null;
  altEmail2?:   string | null;
  altPhone1?:   string | null;
  altPhone2?:   string | null;
  correctCity?:  string | null;
  correctState?: string | null;
  classYear?:    string | null;
  category?:     string | null;
  parentName?:   string | null;
  parentMobile?: string | null;
  gender?:       string | null;
  feedbacks: Feedback[];
  profile?: LeadProfile | null;
  _count?: { feedbacks: number };
}

interface LeadDetailDrawerProps {
  leadId: string | null;
  onClose: () => void;
  canSubmitFeedback?: boolean;
}

interface StaticOption {
  id: number | string;
  name: string;
}

const OTHERS_VALUE = '__OTHERS__';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function displayLeadId(id: string) {
  return id;
}

const TABS = [
  { key: 'overview',  label: 'Overview',     Icon: LayoutList    },
  { key: 'followups', label: 'Follow-Ups',   Icon: CalendarClock },
  { key: 'calls',     label: 'Calls',        Icon: PhoneIncoming },
  { key: 'timeline',  label: 'Timeline',     Icon: GitBranch     },
] as const;
type TabKey = typeof TABS[number]['key'];

// ─── Follow-up slot schema ────────────────────────────────────────────────────

const followUpSchema = z.object({
  feedbackOptionId: z.string().min(1, 'Please select a feedback option'),
  remarks: z.string().trim().min(1, 'Remarks are required').max(1000),
});
type FollowUpForm = z.infer<typeof followUpSchema>;

// ─── Multi-select component ───────────────────────────────────────────────────

interface MultiSelectOption {
  value: string;
  label: string;
}

function MultiSelect({
  options,
  selected,
  onChange,
  placeholder,
  disabled,
}: {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [otherText, setOtherText] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);

  // Values in `selected` that don't match any option (custom / "Others" entries)
  const optionValueSet = useMemo(() => new Set(options.map((o) => o.value)), [options]);
  const customValues = selected.filter((v) => v !== OTHERS_VALUE && !optionValueSet.has(v));
  const othersChecked = selected.includes(OTHERS_VALUE);
  // Show the others text input whenever the sentinel is selected or there are already custom values
  const showOtherInput = othersChecked || customValues.length > 0;

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  // Auto-focus the Others input when it becomes visible
  useEffect(() => {
    if (showOtherInput && othersChecked) {
      setTimeout(() => otherInputRef.current?.focus(), 50);
    }
  }, [showOtherInput, othersChecked]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return options.slice(0, 200);

    const matches = options.filter((o) => o.label.toLowerCase().includes(q));

    // Sort: exact match → starts-with → substring; alphabetical within each tier
    matches.sort((a, b) => {
      const aL = a.label.toLowerCase();
      const bL = b.label.toLowerCase();
      const aExact = aL === q;
      const bExact = bL === q;
      if (aExact !== bExact) return aExact ? -1 : 1;
      const aPrefix = aL.startsWith(q);
      const bPrefix = bL.startsWith(q);
      if (aPrefix !== bPrefix) return aPrefix ? -1 : 1;
      return aL.localeCompare(bL);
    });

    return matches.slice(0, 200);
  }, [options, query]);

  function toggle(value: string) {
    if (value === OTHERS_VALUE) {
      if (othersChecked) {
        onChange(selected.filter((v) => v !== OTHERS_VALUE));
      } else {
        onChange([...selected, OTHERS_VALUE]);
      }
      return;
    }
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  }

  function addCustom() {
    const text = otherText.trim();
    if (!text || selected.includes(text)) { setOtherText(''); return; }
    // Add the custom value; keep the sentinel so input stays visible for more entries
    onChange([...selected, text]);
    setOtherText('');
  }

  function removeValue(v: string) {
    onChange(selected.filter((x) => x !== v));
  }

  function getLabel(v: string) {
    if (v === OTHERS_VALUE) return 'Others';
    return options.find((o) => o.value === v)?.label ?? v;
  }

  // Count for display: exclude the __OTHERS__ sentinel
  const displaySelected = selected.filter((v) => v !== OTHERS_VALUE);

  return (
    <div ref={containerRef} className="relative space-y-1.5">
      {/* ── Trigger ── */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring',
          disabled && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span className={displaySelected.length === 0 ? 'text-muted-foreground' : ''}>
          {displaySelected.length === 0
            ? (placeholder ?? 'Select…')
            : `${displaySelected.length} selected`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 ml-2" />
      </button>

      {/* ── Dropdown ── */}
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-lg">
          <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              autoFocus
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <ul className="max-h-48 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted-foreground">No results</li>
            )}
            {filtered.map((opt) => {
              const checked = selected.includes(opt.value);
              return (
                <li
                  key={opt.value}
                  onClick={() => toggle(opt.value)}
                  className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted/50"
                >
                  <span className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input',
                    checked && 'bg-primary border-primary',
                  )}>
                    {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                  </span>
                  <span className="truncate">{opt.label}</span>
                </li>
              );
            })}
            {options.length > 200 && !query && (
              <li className="px-3 py-1.5 text-xs text-muted-foreground italic">
                Type to search all {options.length} options
              </li>
            )}
          </ul>

          {/* Others — always pinned at the bottom */}
          <div className="border-t border-border">
            <div
              onClick={() => toggle(OTHERS_VALUE)}
              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50"
            >
              <span className={cn(
                'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input',
                othersChecked && 'bg-primary border-primary',
              )}>
                {othersChecked && <Check className="h-3 w-3 text-primary-foreground" />}
              </span>
              <span className="text-muted-foreground italic">Others (custom)</span>
            </div>
          </div>

          {/* Chips footer */}
          {displaySelected.length > 0 && (
            <div className="border-t border-border px-3 py-1.5 flex flex-wrap gap-1">
              {displaySelected.map((v) => (
                <span
                  key={v}
                  className={cn(
                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs border',
                    customValues.includes(v)
                      ? 'bg-amber-500/10 border-amber-400/40 text-amber-700'
                      : 'bg-primary/15 border-primary/30 text-primary',
                  )}
                >
                  {customValues.includes(v) && <span className="opacity-60">custom:</span>}
                  {getLabel(v)}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeValue(v); }}
                    className="hover:text-destructive"
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs text-muted-foreground hover:text-destructive ml-auto"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Others custom text input (shown outside the dropdown) ── */}
      {showOtherInput && (
        <div className="flex gap-2 items-center">
          <input
            ref={otherInputRef}
            type="text"
            value={otherText}
            onChange={(e) => setOtherText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustom(); } }}
            placeholder="Type custom value and press Enter…"
            className="flex h-8 flex-1 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-amber-400 placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={addCustom}
            disabled={!otherText.trim()}
            className="flex h-8 items-center rounded-md border border-amber-300 bg-amber-100 px-3 text-xs font-medium text-amber-800 hover:bg-amber-200 disabled:opacity-40"
          >
            Add
          </button>
        </div>
      )}

      {/* Custom values already added — shown as removable chips below the input */}
      {customValues.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {customValues.map((v) => (
            <span
              key={v}
              className="inline-flex items-center gap-1 rounded-full bg-amber-100 border border-amber-200 px-2.5 py-0.5 text-xs text-amber-800"
            >
              {v}
              <button
                type="button"
                onClick={() => removeValue(v)}
                className="hover:text-destructive ml-0.5"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Student Details Section ──────────────────────────────────────────────────

function StudentDetailsSection({ lead }: { lead: LeadDetail }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [altEmail1,   setAltEmail1]   = useState(lead.altEmail1   ?? '');
  const [altEmail2,   setAltEmail2]   = useState(lead.altEmail2   ?? '');
  const [altPhone1,   setAltPhone1]   = useState(lead.altPhone1   ?? '');
  const [altPhone2,   setAltPhone2]   = useState(lead.altPhone2   ?? '');
  const [correctCity,  setCorrectCity]  = useState(lead.correctCity  ?? '');
  const [correctState, setCorrectState] = useState(lead.correctState ?? '');

  const saveMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/leads/${lead.id}/student-details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          altEmail1:   altEmail1.trim()   || null,
          altEmail2:   altEmail2.trim()   || null,
          altPhone1:   altPhone1.trim()   || null,
          altPhone2:   altPhone2.trim()   || null,
          correctCity:  correctCity.trim()  || null,
          correctState: correctState.trim() || null,
        }),
      }).then(async (r) => {
        const json = await r.json();
        if (json.error) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to save');
        return json;
      }),
    onSuccess: () => {
      toast({ title: 'Student details saved' });
      qc.invalidateQueries({ queryKey: ['lead-detail', lead.id] });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  const fieldClass =
    'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground';
  const labelClass = 'text-[10px] font-bold uppercase tracking-wider text-muted-foreground';

  return (
    <div className="px-5 py-4 space-y-5">
      <div className="rounded-lg border border-border/60 p-4 space-y-1">
        <p className="text-xs font-bold text-muted-foreground">Original Details</p>
        <p className="text-sm font-medium">{lead.phone}</p>
        <p className="text-sm text-muted-foreground">{lead.email}</p>
        {(lead.city || lead.state) && (
          <p className="text-sm text-muted-foreground">{[lead.city, lead.state].filter(Boolean).join(', ')}</p>
        )}
      </div>

      <div className="space-y-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Corrected / Alternate Details
        </p>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className={labelClass}>Alt. Email 1</label>
            <input type="email" className={fieldClass} placeholder="email@example.com"
              value={altEmail1} onChange={(e) => setAltEmail1(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Alt. Email 2</label>
            <input type="email" className={fieldClass} placeholder="email@example.com"
              value={altEmail2} onChange={(e) => setAltEmail2(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Alt. Phone 1</label>
            <input type="tel" className={fieldClass} placeholder="10-digit number"
              value={altPhone1} onChange={(e) => setAltPhone1(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Alt. Phone 2</label>
            <input type="tel" className={fieldClass} placeholder="10-digit number"
              value={altPhone2} onChange={(e) => setAltPhone2(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Correct City</label>
            <input type="text" className={fieldClass} placeholder="City name"
              value={correctCity} onChange={(e) => setCorrectCity(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className={labelClass}>Correct State</label>
            <input type="text" className={fieldClass} placeholder="State name"
              value={correctState} onChange={(e) => setCorrectState(e.target.value)} />
          </div>
        </div>
      </div>

      <Button
        className="w-full"
        onClick={() => saveMutation.mutate()}
        disabled={saveMutation.isPending}
      >
        {saveMutation.isPending
          ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          : <CheckCircle2 className="mr-1.5 h-4 w-4" />}
        Save Details
      </Button>
    </div>
  );
}

// ─── Follow-up slot ───────────────────────────────────────────────────────────

function FollowUpSlot({
  slotNumber,
  existing,
  canSubmit,
  leadId,
  isLocked,
  feedbackOptions,
  onSubmitted,
}: {
  slotNumber: number;
  existing?: Feedback;
  canSubmit: boolean;
  leadId: string;
  isLocked: boolean;
  feedbackOptions: FeedbackOptionItem[];
  onSubmitted: () => void;
}) {
  const { toast } = useToast();
  const [scheduledAt, setScheduledAt] = useState('');

  const { register, handleSubmit, setValue, reset, formState: { errors } } = useForm<FollowUpForm>({
    resolver: zodResolver(followUpSchema),
  });

  const minDateTime = new Date(Date.now() + 60_000).toISOString().slice(0, 16);

  const mutation = useMutation({
    mutationFn: (data: FollowUpForm) =>
      fetch(`/api/leads/${leadId}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, scheduledAt: scheduledAt || null }),
      }).then(async (r) => {
        const json = await r.json();
        if (json.error) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to save');
        return json;
      }),
    onSuccess: (_, variables) => {
      const selectedLabel = feedbackOptions.find((o) => o.id === variables.feedbackOptionId)?.label ?? '';
      if (isCelebrationFeedback(selectedLabel)) {
        triggerCelebration();
      }
      toast({ title: scheduledAt ? `Follow-up ${slotNumber} saved · Call scheduled` : `Follow-up ${slotNumber} saved` });
      onSubmitted();
      reset();
      setScheduledAt('');
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    },
  });

  if (existing) {
    return (
      <div className="rounded-lg border border-border/60 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border/60">
          <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
            Follow-up {slotNumber}
          </span>
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase bg-green-500/20 text-green-400 border border-green-500/30">
            ● Completed
          </span>
        </div>
        <div className="px-4 py-3 space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-primary/15 text-primary border border-primary/30">
              {existing.feedbackOption.label}
            </span>
            <span className="text-xs text-muted-foreground">{new Date(existing.createdAt).toLocaleDateString('en-GB')}</span>
          </div>
          {existing.remarks && (
            <p className="text-sm text-foreground">{existing.remarks}</p>
          )}
          <p className="text-xs text-muted-foreground">By {existing.agent.name}</p>
        </div>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div className="rounded-lg border border-border/40 overflow-hidden opacity-50 select-none">
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/10 border-b border-border/40">
          <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
            Follow-up {slotNumber}
          </span>
          <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase bg-muted/30 text-muted-foreground">
            ● Pending
          </span>
        </div>
        <div className="px-4 py-3 text-xs text-muted-foreground">
          Unlocks after Follow-up {slotNumber - 1} is completed.
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-muted/20 border-b border-border/60">
        <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">
          Follow-up {slotNumber}
        </span>
        <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30">
          ● Pending
        </span>
      </div>

      <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="px-4 py-3 space-y-3">
        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Feedback <span className="text-destructive">*</span>
          </label>
          {feedbackOptions.length === 0 ? (
            <p className="text-xs text-destructive">
              No feedback options configured. Ask your admin to add options first.
            </p>
          ) : (
            <select
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              defaultValue=""
              onChange={(e) => setValue('feedbackOptionId', e.target.value)}
            >
              <option value="" disabled>Select outcome…</option>
              {feedbackOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          )}
          {errors.feedbackOptionId && (
            <p className="text-xs text-destructive">{errors.feedbackOptionId.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Remarks <span className="text-destructive normal-case font-semibold">*</span>
          </label>
          <textarea
            className="flex min-h-[72px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring placeholder:text-muted-foreground resize-none"
            placeholder="Describe the conversation outcome..."
            {...register('remarks')}
          />
          {errors.remarks && (
            <p className="text-xs text-destructive">{errors.remarks.message}</p>
          )}
        </div>

        {/* Schedule next call */}
        <div className="space-y-1.5 rounded-lg border border-dashed border-amber-300/60 bg-amber-50/40 dark:border-amber-700/40 dark:bg-amber-950/20 p-3">
          <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
            <CalendarClock className="h-3 w-3" />
            Schedule Next Call
            <span className="normal-case font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            type="datetime-local"
            value={scheduledAt}
            min={minDateTime}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:auto]"
          />
          {scheduledAt && (
            <button
              type="button"
              onClick={() => setScheduledAt('')}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" /> Clear schedule
            </button>
          )}
        </div>

        {canSubmit ? (
          <Button
            type="submit"
            className="w-full bg-green-600 hover:bg-green-700 text-white font-medium"
            disabled={mutation.isPending || feedbackOptions.length === 0}
          >
            {mutation.isPending
              ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
            Save &amp; Mark Complete
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-1">No permission to submit feedback.</p>
        )}
      </form>
    </div>
  );
}

// ─── Calls tab ───────────────────────────────────────────────────────────────

interface ScheduledCallItem {
  id: string;
  scheduledAt: string;
  note?: string | null;
  status: 'PENDING' | 'DONE' | 'CANCELLED';
}

function CallsTab({ leadId, feedbacks }: { leadId: string; feedbacks: Feedback[] }) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: schedules = [], isLoading } = useQuery<ScheduledCallItem[]>({
    queryKey: ['lead-schedule', leadId],
    queryFn: () =>
      fetch(`/api/leads/${leadId}/schedule`).then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
  });

  const updateSchedule = useMutation({
    mutationFn: ({ scheduleId, status }: { scheduleId: string; status: string }) =>
      fetch(`/api/leads/${leadId}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduleId, status }),
      }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lead-schedule', leadId] }),
    onError: () => toast({ variant: 'destructive', title: 'Failed to update schedule' }),
  });

  const pending = schedules.filter((s) => s.status === 'PENDING');
  const past    = schedules.filter((s) => s.status !== 'PENDING');

  return (
    <div className="px-5 py-4 space-y-4">
      {/* Scheduled call */}
      {isLoading ? (
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
      ) : pending.length > 0 ? (
        <div>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Upcoming Scheduled Call</p>
          {pending.map((s) => (
            <div key={s.id} className="rounded-lg border border-amber-300/60 bg-amber-50/50 dark:border-amber-700/40 dark:bg-amber-950/20 p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                      {new Date(s.scheduledAt).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {new Date(s.scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200/60 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
                  SCHEDULED
                </span>
              </div>
              {s.note && <p className="text-xs text-muted-foreground">{s.note}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => updateSchedule.mutate({ scheduleId: s.id, status: 'DONE' })}
                  disabled={updateSchedule.isPending}
                  className="flex-1 rounded-md bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  Mark Done
                </button>
                <button
                  onClick={() => updateSchedule.mutate({ scheduleId: s.id, status: 'CANCELLED' })}
                  disabled={updateSchedule.isPending}
                  className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
          <CalendarClock className="h-4 w-4 opacity-50 shrink-0" />
          No upcoming scheduled call. Schedule one via Follow-Ups.
        </div>
      )}

      {/* Call log */}
      <div>
        <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Call Log</p>
        {feedbacks.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-muted-foreground">
            <Phone className="h-8 w-8 opacity-30" />
            <p className="text-sm">No calls logged yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {feedbacks.map((f) => (
              <div key={f.id} className="rounded-lg border border-border/60 p-3 space-y-1.5 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-xs">Follow-up #{f.followUpNumber}</span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-primary/15 text-primary border border-primary/30">
                    {f.feedbackOption.label}
                  </span>
                </div>
                {f.remarks && <p className="text-foreground">{f.remarks}</p>}
                <p className="text-xs text-muted-foreground">
                  {new Date(f.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {f.agent.name}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Past schedules */}
        {past.length > 0 && (
          <div className="mt-3 space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Past Schedules</p>
            {past.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-md border border-border/40 px-3 py-2 text-xs text-muted-foreground">
                <span>{new Date(s.scheduledAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} {new Date(s.scheduledAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                <span className={cn('font-semibold', s.status === 'DONE' ? 'text-green-500' : 'text-red-400')}>
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main drawer ──────────────────────────────────────────────────────────────

export function LeadDetailDrawer({ leadId, onClose, canSubmitFeedback = false }: LeadDetailDrawerProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const qc = useQueryClient();
  const { data: session } = useSession();
  const agentName = session?.user?.name ?? 'Your Counsellor';

  const { data: lead, isLoading } = useQuery<LeadDetail>({
    queryKey: ['lead-detail', leadId],
    queryFn: () => fetch(`/api/leads/${leadId}`).then((r) => r.json()),
    enabled: !!leadId,
  });

  const { data: feedbackOptions = [] } = useQuery<FeedbackOptionItem[]>({
    queryKey: ['feedback-options'],
    queryFn: () =>
      fetch('/api/feedback-options').then(async (r) => {
        const d = await r.json();
        return Array.isArray(d) ? d : [];
      }),
    enabled: canSubmitFeedback,
  });

  const profilingScore = useMemo(() => (lead ? computeProfilingScore(lead) : null), [lead]);

  const feedbacks = lead?.feedbacks ?? [];
  const feedbackCount = feedbacks.length;

  const handleFeedbackSubmitted = () => {
    qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
    qc.invalidateQueries({ queryKey: ['my-leads'] });
    qc.invalidateQueries({ queryKey: ['all-leads'] });
    qc.invalidateQueries({ queryKey: ['feedback-category-counts'] });
  };


  return (
    <AnimatePresence>
      {leadId && (
        <>
          <motion.div
            key="drawer-backdrop"
            className="fixed inset-0 z-30 bg-black/20 md:hidden"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />

          <motion.div
            key="drawer-panel"
            className="fixed right-0 top-0 z-40 h-dvh w-full max-w-[500px] border-l border-border bg-background shadow-2xl flex flex-col"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 300 }}
          >

        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-start justify-between border-b border-border px-5 py-4 shrink-0">
          {isLoading || !lead ? (
            <div className="space-y-1.5">
              <div className="h-5 w-40 rounded bg-muted animate-pulse" />
              <div className="h-3.5 w-28 rounded bg-muted animate-pulse" />
            </div>
          ) : (
            <div>
              <h2 className="text-lg font-bold leading-tight">{lead.name}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {displayLeadId(lead.id)}
                {lead.leadZone && ` · ${lead.leadZone} Zone`}
              </p>
            </div>
          )}
          <div className="flex items-center gap-2 shrink-0">
          {profilingScore && (() => {
            const tone = profilingScoreTone(profilingScore.percentage);
            const radius = 19;
            const circumference = 2 * Math.PI * radius;
            const offset = circumference - (profilingScore.percentage / 100) * circumference;
            return (
              <div
                title={`Profile ${profilingScore.percentage}% complete — ${profilingScore.filled}/${profilingScore.total} fields filled`}
                className="relative flex h-11 w-11 shrink-0 items-center justify-center"
              >
                <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
                  <circle cx="22" cy="22" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-muted/40" />
                  <circle
                    cx="22" cy="22" r={radius} fill="none" stroke={tone.ring} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={offset}
                    style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
                  />
                </svg>
                <span className={cn('absolute font-extrabold tabular-nums leading-none', tone.text, profilingScore.percentage === 100 ? 'text-[10px]' : 'text-[11px]')}>
                  {profilingScore.percentage}
                  <span className="text-[8px] font-bold">%</span>
                </span>
              </div>
            );
          })()}
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
          </div>
        </div>

        {/* ── Tabs ───────────────────────────────────────────────── */}
        <div className="flex border-b border-border shrink-0 overflow-x-auto scrollbar-none [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={cn(
                'relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
                activeTab === key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              {label}
            </button>
          ))}
          {lead && (
            <button
              onClick={() => window.open(`/leads/${lead.id}/profile`, '_blank')}
              className="relative flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 border-transparent text-primary hover:text-primary/80 transition-colors ml-auto"
            >
              <UserCircle2 className="h-3.5 w-3.5 shrink-0" />
              View Lead Profile
              <ExternalLink className="h-3 w-3 shrink-0" />
            </button>
          )}
        </div>

        {/* ── Tab content ────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {isLoading || !lead ? (
            <div className="flex justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {/* ── OVERVIEW ─────────────────────────────────────── */}
              {activeTab === 'overview' && (
                <div className="px-5 py-4 space-y-5">
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <PhoneCall className="h-5 w-5 text-[#e90000]" />
                      <span className="text-2xl font-bold tracking-wide text-[#e90000]">
                        {lead.phone}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs" asChild>
                        <a href={`mailto:${lead.email}`}>
                          <Mail className="h-3.5 w-3.5" /> Email
                        </a>
                      </Button>
                      <Button size="sm" className="gap-1.5 bg-[#0e4164] hover:bg-[#0c3755] text-white text-xs" asChild>
                        <a href={`tel:${lead.phone}`}>
                          <Phone className="h-3.5 w-3.5" /> Call
                        </a>
                      </Button>
                      <WhatsAppButton
                        phone={lead.phone}
                        leadName={lead.name}
                        agentName={agentName}
                        course={lead.course}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <span className="inline-flex items-center gap-1 text-xs font-medium rounded-full border px-2.5 py-0.5 text-emerald-600 border-emerald-300/50 bg-emerald-500/10">
                        ● {feedbackCount === 0 ? 'Fresh Lead' : 'Active Lead'}
                      </span>
                      {feedbackCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium rounded-full border px-2.5 py-0.5 text-amber-600 border-amber-300/50 bg-amber-500/10">
                          ● Follow-Up
                        </span>
                      )}
                    </div>
                  </div>

                  <IntroScriptAccordion lead={lead} agentName={agentName} />

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                      Lead Information
                    </p>
                    <dl className="space-y-0">
                      <InfoRow label="Email" value={lead.email} />
                      <InfoRow label="College" value={lead.college} />
                      <InfoRow label="Course" value={lead.course} />
                      <InfoRow label="State / City" value={[lead.state, lead.city].filter(Boolean).join(' / ')} />
                      <InfoRow label="Zone" value={lead.leadZone} />
                      <InfoRow label="Campaign" value={lead.campaign} />
                      <InfoRow label="Lead Type" value={lead.leadType} />
                      <InfoRow
                        label="Date Added"
                        value={lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-CA') : undefined}
                      />
                    </dl>
                  </div>

                  {(lead.primaryApplicationConfirm || lead.primaryAdmissionConfirm ||
                    lead.leadConfirmation || lead.leadStage ||
                    lead.leadVerification || lead.dataCallingType) && (
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                        Lead Tracking
                      </p>
                      <dl className="space-y-0">
                        <InfoRow label="Primary App. Confirm"  value={lead.primaryApplicationConfirm} />
                        <InfoRow label="Primary Adm. Confirm"  value={lead.primaryAdmissionConfirm} />
                        <InfoRow label="Lead Confirmation"     value={lead.leadConfirmation} />
                        <InfoRow label="Lead Stage"            value={lead.leadStage} />
                        <InfoRow label="Lead Verification"     value={lead.leadVerification} />
                        <InfoRow label="Data Calling Type"     value={lead.dataCallingType} />
                      </dl>
                    </div>
                  )}

                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
                      Calling Info
                    </p>
                    <dl className="space-y-0">
                      <InfoRow label="Assigned To"     value={lead.assignedTo?.name}     valueClassName="text-green-600 dark:text-green-400" />
                      <InfoRow label="Assigned From"   value={lead.assignedFrom?.name}   valueClassName="text-red-600 dark:text-red-400" />
                      <InfoRow label="Prev Assignee 1" value={lead.assignedBy?.name}     valueClassName="text-green-600 dark:text-green-400" />
                      <InfoRow label="Prev Assignee 2" value={lead.prevAssignee2?.name}  valueClassName="text-red-600 dark:text-red-400" />
                    </dl>
                  </div>
                </div>
              )}

              {/* ── FOLLOW-UPS ────────────────────────────────────── */}
              {activeTab === 'followups' && (
                <div className="px-5 py-4 space-y-3">
                  <p className="text-xs text-muted-foreground">
                    Unlimited follow-ups per lead. Each new slot unlocks after the previous one is completed.
                  </p>
                  {Array.from({ length: feedbackCount + 1 }).map((_, i) => {
                    const slotNum = i + 1;
                    const existing = feedbacks.find((f) => f.followUpNumber === slotNum);
                    const isLocked = !existing && slotNum > feedbackCount + 1;
                    return (
                      <FollowUpSlot
                        key={slotNum}
                        slotNumber={slotNum}
                        existing={existing}
                        canSubmit={canSubmitFeedback}
                        leadId={lead.id}
                        isLocked={isLocked}
                        feedbackOptions={feedbackOptions}
                        onSubmitted={handleFeedbackSubmitted}
                      />
                    );
                  })}
                </div>
              )}

              {/* ── CALLS ─────────────────────────────────────────── */}
              {activeTab === 'calls' && (
                <CallsTab leadId={lead.id} feedbacks={feedbacks} />
              )}

              {/* ── TIMELINE ──────────────────────────────────────── */}
              {activeTab === 'timeline' && (
                <TimelineTab leadId={lead.id} />
              )}

            </>
          )}
        </div>
      </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─── Timeline Tab ─────────────────────────────────────────────────────────────

interface TimelineEvent {
  id: string;
  type: 'CREATED' | 'APPROVED' | 'ASSIGNED' | 'FEEDBACK' | 'SCHEDULED_CALL' | 'RECEIPT';
  timestamp: string;
  title: string;
  subtitle?: string;
  badge?: string;
}

const TIMELINE_ICON: Record<TimelineEvent['type'], React.ReactNode> = {
  CREATED:        <PlusCircle   className="h-4 w-4 text-emerald-500" />,
  APPROVED:       <FileCheck    className="h-4 w-4 text-blue-500" />,
  ASSIGNED:       <UserPlus     className="h-4 w-4 text-violet-500" />,
  FEEDBACK:       <PhoneIncoming className="h-4 w-4 text-primary" />,
  SCHEDULED_CALL: <Clock3       className="h-4 w-4 text-amber-500" />,
  RECEIPT:        <Receipt      className="h-4 w-4 text-green-600" />,
};

const TIMELINE_DOT: Record<TimelineEvent['type'], string> = {
  CREATED:        'bg-emerald-500',
  APPROVED:       'bg-blue-500',
  ASSIGNED:       'bg-violet-500',
  FEEDBACK:       'bg-primary',
  SCHEDULED_CALL: 'bg-amber-500',
  RECEIPT:        'bg-green-600',
};

const SCHEDULE_STATUS_BADGE: Record<string, string> = {
  PENDING:   'bg-amber-500/15 text-amber-600 border-amber-300/50',
  DONE:      'bg-green-500/15 text-green-600 border-green-300/50',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
};

function TimelineTab({ leadId }: { leadId: string }) {
  const { data: events = [], isLoading } = useQuery<TimelineEvent[]>({
    queryKey: ['lead-timeline', leadId],
    queryFn: () => fetch(`/api/leads/${leadId}/timeline`).then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
  });

  if (isLoading) {
    return (
      <div className="px-5 py-4 space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-1.5 pt-1">
              <div className="h-3 w-48 rounded bg-muted" />
              <div className="h-2.5 w-32 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
        <GitBranch className="mb-2 h-8 w-8 opacity-30" />
        <p className="text-sm">No timeline events yet</p>
      </div>
    );
  }

  return (
    <div className="px-5 py-4">
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-[15px] top-2 bottom-2 w-px bg-border/60" />

        <div className="space-y-0">
          {events.map((event, idx) => (
            <div key={event.id} className={cn('relative flex gap-3', idx !== events.length - 1 && 'pb-5')}>
              {/* Dot */}
              <div className={cn('relative z-10 mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-background', TIMELINE_DOT[event.type])}>
                <div className="text-white [&>svg]:h-3.5 [&>svg]:w-3.5">
                  {TIMELINE_ICON[event.type]}
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-0.5">
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <p className="text-sm font-medium text-foreground leading-snug">{event.title}</p>
                  {event.badge && (event.type === 'SCHEDULED_CALL') && (
                    <span className={cn(
                      'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                      SCHEDULE_STATUS_BADGE[event.badge] ?? 'bg-muted text-muted-foreground border-border'
                    )}>
                      {event.badge}
                    </span>
                  )}
                  {event.badge && (event.type === 'RECEIPT') && (
                    <span className="shrink-0 rounded-full border border-green-300/50 bg-green-500/10 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:text-green-400">
                      {event.badge}
                    </span>
                  )}
                </div>
                {event.subtitle && (
                  <p className="mt-0.5 text-xs text-muted-foreground truncate">{event.subtitle}</p>
                )}
                <p className="mt-1 text-[10px] text-muted-foreground/70">
                  {new Date(event.timestamp).toLocaleString('en-IN', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true,
                  })}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Small helpers ────────────────────────────────────────────────────────────

function IntroScriptAccordion({ lead, agentName }: { lead: LeadDetail; agentName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-amber-300/50 bg-amber-500/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Intro Script</p>
        <ChevronDown className={cn('h-3.5 w-3.5 text-amber-600 transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="px-4 pb-4">
          <p className="text-sm leading-relaxed text-amber-900 dark:text-amber-200">
            &ldquo;Hello, am I speaking with {lead.name}? This is {agentName} calling from KollegeApply.
            You recently showed interest in {lead.college || lead.course || '[College/Course]'}.
            Is this a good time to chat for 5–7 minutes about your admission journey?&rdquo;
          </p>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, valueClassName }: { label: string; value?: string | null; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border/40 last:border-0">
      <dt className="text-xs text-muted-foreground shrink-0">{label}</dt>
      <dd className={cn('text-sm font-medium text-right', value ? valueClassName : '')}>{value || '—'}</dd>
    </div>
  );
}
