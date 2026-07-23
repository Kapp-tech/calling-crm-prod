'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, GraduationCap, Landmark, Wallet, Home, BarChart3,
  FileText, Check, ChevronDown, ChevronUp, Search, X, CheckCircle2, Handshake, CreditCard,
  School, Building2, RefreshCw, Receipt, ExternalLink, UserPlus, Users, Phone,
  Clock3, XCircle, Webhook,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { ReceiptUploadDialog, type ReceiptKind } from '@/components/leads/receipt-upload-dialog';
import { computeProfilingScore, profilingScoreTone } from '@/lib/lead-profiling';
import { WhatsAppButton } from '@/components/shared/whatsapp-button';

const STEP_BY_NAME: Record<string, number> = {
  'Basic Info': 1,
  'Preferences': 2,
  'Budget': 3,
  'Stay': 4,
  'Academics': 5,
};

interface LeadReceiptRecord {
  id: string;
  type: ReceiptKind;
  status: 'PENDING' | 'APPROVED' | 'DISAPPROVED';
  disapprovalReason?: string | null;
  createdAt: string;
  uploadedBy: { name: string };
  reviewedBy?: { name: string } | null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LeadDetail {
  id: string;
  name: string;
  email: string;
  phone: string;
  city?: string | null;
  state?: string | null;
  course?: string | null;
  college?: string | null;
  leadOrigin?: string | null;
  leadZone?: string | null;
  altEmail1?: string | null;
  altEmail2?: string | null;
  altPhone1?: string | null;
  altPhone2?: string | null;
  correctCity?: string | null;
  correctState?: string | null;
  parentName?: string | null;
  parentMobile?: string | null;
  gender?: string | null;
  classYear?: string | null;
  category?: string | null;
  profile?: {
    budget?: string | null;
    preferredCourseIds?: unknown;
    preferredCollegeIds?: unknown;
    preferredCityNames?: unknown;
    preferredStateNames?: unknown;
    courseType?: string | null;
    collegeType?: string | null;
    specialisation?: string | null;
    entranceExam?: unknown;
    scholarshipAwareness?: string | null;
    loanRequirement?: string | null;
    loanAmount?: string | null;
    paymentModePreference?: string | null;
    stayPreference?: string | null;
    monthlyAccommodationBudget?: string | null;
    roomSharing?: string | null;
    mealsPreference?: string | null;
    keyAmenities?: unknown;
    distanceWillingness?: string | null;
    genderHostelRequirement?: string | null;
    class10Percentage?: string | null;
    class12Percentage?: string | null;
    board?: string | null;
    gapYearReason?: string | null;
    mediumOfInstruction?: string | null;
  } | null;
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

interface BasicInfoForm {
  fullName: string;
  mobile: string;
  email: string;
  parentName: string;
  parentMobile: string;
  city: string;
  state: string;
  classYear: string;
  gender: string;
  category: string;
  correctPhone1: string;
  correctPhone2: string;
  correctEmail1: string;
  correctEmail2: string;
  correctCity: string[];
  correctState: string[];
}

interface CoursesCollegesForm {
  courseInterested: string[];
  courseType: string[];
  specialisation: string;
  collegeInterested: string[];
  collegeType: string[];
  cityPreference: string[];
  statePreference: string[];
  entranceExam: string[];
}

interface BudgetForm {
  totalCourseBudget: string[];
  scholarshipAwareness: string[];
  loanRequirement: string;
  loanAmount: string[];
  paymentModePreference: string;
}

interface StayForm {
  stayPreference: string;
  monthlyAccommodationBudget: string[];
  roomSharing: string;
  mealsPreference: string;
  keyAmenities: string[];
  distanceWillingness: string;
  genderHostelRequirement: string;
}

interface AcademicsForm {
  class10Percentage: string;
  class12Percentage: string;
  board: string[];
  gapYearReason: string;
  mediumOfInstruction: string;
}

interface StaticOption {
  id: number | string;
  name: string;
}

interface Option {
  value: string;
  label: string;
}

function toOptions(values: string[]): Option[] {
  return values.map((v) => ({ value: v, label: v }));
}

function toOptionsFromStatic(list: StaticOption[]): Option[] {
  return list.map((o) => ({ value: String(o.id), label: o.name }));
}

function idsToNames(ids: string[], list: StaticOption[]): string[] {
  return ids.map((id) => list.find((o) => String(o.id) === id)?.name ?? id);
}

// ─── Steps / Quick actions ─────────────────────────────────────────────────────

const STEPS = [
  { key: 1, label: 'Basic Info',         Icon: GraduationCap,  quickLabel: 'Basic Info' },
  { key: 2, label: 'Preferences',        Icon: Landmark,        quickLabel: 'Preferences' },
  { key: 3, label: 'Budget',             Icon: Wallet,          quickLabel: 'Budget & Finance' },
  { key: 4, label: 'Stay',               Icon: Home,            quickLabel: 'Accommodation' },
  { key: 5, label: 'Academics',          Icon: BarChart3,       quickLabel: 'Academic Profile' },
  { key: 6, label: 'Summary',            Icon: FileText,        quickLabel: 'Summary & Submit' },
] as const;

const CLASS_YEAR_OPTIONS = [
  'Class 11', 'Class 12 (Appearing)', 'Class 12 (Passed)', 'Dropper / Gap Year',
  'Graduation (Pursuing)', 'Graduation (Passed)', 'Post Graduate', 'Working Professional',
];
const GENDER_OPTIONS = ['Male', 'Female', 'Other'];
const CATEGORY_OPTIONS = ['General', 'SC/ST', 'OBC', 'EWS'];
const COURSE_TYPE_OPTIONS = toOptions(['Regular', 'Online', 'Distance']);
const COLLEGE_TYPE_OPTIONS = toOptions(['Government', 'Private', 'Government+Private', 'Deemed']);
const ENTRANCE_EXAM_OPTIONS = toOptions([
  'JEE Main', 'JEE Advanced', 'NEET', 'BITSAT', 'VITEEE', 'CUET', 'CAT', 'XAT', 'MAT', 'CMAT', 'CLAT', 'GATE', 'None / Not Applicable',
]);
const BUDGET_RANGE_OPTIONS = toOptions([
  'Below 2 Lakhs', '2 to 5 Lakhs', '5 to 10 Lakhs', '10 to 20 Lakhs', '20 to 40 Lakhs', '40 Lakhs+',
]);
const SCHOLARSHIP_OPTIONS = toOptions(['Aware & Applied', 'Aware – Not Applied', 'Not Aware', 'Not Interested']);
const PAYMENT_MODE_OPTIONS = ['Full Upfront', 'Semester-wise', 'Yearly', 'EMI Plan', 'Need Flexibility'];
const LOAN_REQUIREMENT_OPTIONS = [
  { value: 'Yes, Needed',    subtitle: 'Requires loan support', Icon: CheckCircle2 },
  { value: 'Partial',        subtitle: 'Part self, part loan',  Icon: Handshake },
  { value: 'No, Self-Funded', subtitle: 'No loan required',     Icon: CreditCard },
];
const LOAN_AMOUNT_OPTIONS = toOptions([
  'Below 5 Lakhs', '5 to 10 Lakhs', '10 to 20 Lakhs', '20 to 50 Lakhs', '50 Lakhs+',
]);
const STAY_PREFERENCE_OPTIONS = [
  { value: 'Campus Hostel',       subtitle: 'Stay within college campus',  Icon: School },
  { value: 'PG / Rented',         subtitle: 'Private accommodation nearby', Icon: Building2 },
  { value: 'Day Scholar / Home',  subtitle: 'Commute from home daily',     Icon: Home },
  { value: 'Flexible / Decide Later', subtitle: 'Not finalised yet',       Icon: RefreshCw },
];
const MONTHLY_ACCOMMODATION_BUDGET_OPTIONS = toOptions([
  'Below ₹5,000', '₹5,000 – ₹10,000', '₹10,000 – ₹15,000', '₹15,000 – ₹25,000', '₹25,000+',
]);
const ROOM_SHARING_OPTIONS = ['Single Occupancy', 'Double Sharing', 'Triple Sharing', 'No Preference'];
const MEALS_OPTIONS = ['Mess Included', 'Veg Only', 'Cook Self', 'Outside Canteen', 'No Preference'];
const KEY_AMENITY_OPTIONS = ['Wi-Fi / Internet', '24×7 Security', 'AC Room', 'Study Room', 'Laundry', 'Gym / Sports', 'Library Access'];
const DISTANCE_OPTIONS = ['Walking Distance (<1 km)', 'Upto 3 km', 'Upto 5 km', 'Any Distance (Transport Avail)'];
const GENDER_HOSTEL_OPTIONS = ['Boys Only Hostel', 'Girls Only Hostel', 'Co-Ed (Any)', 'No Preference'];
const BOARD_OPTIONS = toOptions(['CBSE', 'ICSE', 'State Board', 'IB', 'IGCSE', 'NIOS', 'Other']);
const GAP_YEAR_OPTIONS = ['No Gap', 'Exam Preparation', 'Health / Family', 'Work / Internship', 'Preferred Not to Disclose'];
const MEDIUM_OF_INSTRUCTION_OPTIONS = ['English', 'Hindi', 'Regional Language', 'No Preference'];

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || 'ST';
}

// ─── Shared location options (fetched from the same API used for Course/College prefs) ──

function useLocationOptions() {
  const { data: statesRaw } = useQuery({
    queryKey: ['locations-state'],
    queryFn: () => fetch('/api/locations?type=state').then((r) => r.json()),
    staleTime: Infinity,
  });

  const { data: citiesRaw } = useQuery({
    queryKey: ['locations-city'],
    queryFn: () => fetch('/api/locations?type=city').then((r) => r.json()),
    staleTime: Infinity,
  });

  const stateOptions = useMemo<StaticOption[]>(() => {
    const list: { name: string }[] = statesRaw?.data ?? [];
    return list.map((s) => ({ id: s.name, name: s.name }));
  }, [statesRaw]);

  const cityOptions = useMemo<StaticOption[]>(() => {
    const list: { city_name: string }[] = citiesRaw?.data ?? [];
    return list.map((c) => ({ id: c.city_name, name: c.city_name }));
  }, [citiesRaw]);

  return { stateOptions, cityOptions };
}

// ─── Shared field styling (compact) ────────────────────────────────────────────

const INPUT_CLASS =
  'flex h-9 w-full items-center rounded-md border border-input bg-background px-3 text-[13px] text-foreground shadow-sm transition-all duration-150 placeholder:text-muted-foreground/60 hover:border-primary/40 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15';
const DISABLED_INPUT_CLASS =
  'flex h-9 w-full items-center rounded-md border border-border bg-muted/50 px-3 text-[13px] text-muted-foreground/90 shadow-sm cursor-not-allowed';
const LABEL_CLASS = 'text-xs font-semibold text-foreground/80';

// ─── MultiSelect (searchable, multi-select dropdown) ───────────────────────────

function MultiSelect({
  options, selected, onChange, placeholder, disabled,
}: {
  options: Option[];
  selected: string[];
  onChange: (v: string[]) => void;
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

  function toggle(value: string) {
    if (disabled) return;
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
  }

  function getLabel(v: string) {
    return options.find((o) => o.value === v)?.label ?? v;
  }

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
        <span className={cn('truncate text-left', selected.length === 0 && 'text-muted-foreground/60')}>
          {selected.length === 0
            ? (placeholder ?? '— Select —')
            : selected.length === 1
            ? getLabel(selected[0])
            : `${selected.length} selected`}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
      </button>

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-background shadow-lg overflow-hidden animate-scale-in origin-top">
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
              const checked = selected.includes(opt.value);
              return (
                <li
                  key={opt.value}
                  onClick={() => toggle(opt.value)}
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
            {options.length > 200 && !query && (
              <li className="px-3 py-1.5 text-[11px] italic text-muted-foreground">
                Type to search all {options.length} options
              </li>
            )}
          </ul>

          {selected.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 border-t border-border px-2.5 py-1.5">
              {selected.map((v) => (
                <span key={v} className="inline-flex items-center gap-1 rounded bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[11px] text-primary">
                  {getLabel(v)}
                  <button type="button" onClick={(e) => { e.stopPropagation(); toggle(v); }} className="hover:text-destructive">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
              <button type="button" onClick={() => onChange([])} className="ml-auto text-[11px] text-muted-foreground hover:text-destructive">
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Pill group ─────────────────────────────────────────────────────────────

function PillGroup({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(value === opt ? '' : opt)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200 ease-premium active:scale-95',
            value === opt
              ? 'border-primary bg-primary text-primary-foreground shadow-sm scale-105'
              : 'border-input bg-background text-foreground hover:border-primary/40 hover:bg-primary/5 hover:-translate-y-0.5'
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── Card select (for Loan Requirement) ────────────────────────────────────────

function CardSelect({
  options, value, onChange,
}: {
  options: { value: string; subtitle: string; Icon: typeof CheckCircle2 }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3">
      {options.map(({ value: opt, subtitle, Icon }) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(value === opt ? '' : opt)}
          className={cn(
            'group/card flex flex-col items-center gap-1 rounded-lg border-2 px-3 py-2.5 text-center transition-all duration-200 ease-premium active:scale-95 sm:min-w-[140px] sm:flex-1',
            value === opt
              ? 'border-primary bg-primary/5 shadow-md shadow-primary/10 -translate-y-0.5'
              : 'border-input bg-background hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-sm'
          )}
        >
          <Icon className={cn('h-5 w-5 transition-transform duration-200 ease-premium group-hover/card:scale-110', value === opt ? 'text-primary' : 'text-muted-foreground/60')} />
          <span className="text-sm font-bold">{opt}</span>
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </button>
      ))}
    </div>
  );
}

// ─── Multi pill group (for Key Amenity Requirements) ───────────────────────────

function MultiPillGroup({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  function toggle(opt: string) {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  }
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => toggle(opt)}
          className={cn(
            'rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200 ease-premium active:scale-95',
            value.includes(opt)
              ? 'border-primary bg-primary text-primary-foreground shadow-sm scale-105'
              : 'border-input bg-background text-foreground hover:border-primary/40 hover:bg-primary/5 hover:-translate-y-0.5'
          )}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function LeadProfilePage({ leadId, agentName }: { leadId: string; agentName: string }) {
  const { data: lead, isLoading } = useQuery<LeadDetail>({
    queryKey: ['lead-detail', leadId],
    queryFn: () => fetch(`/api/leads/${leadId}`).then((r) => r.json()),
  });
  const qc = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();

  const profilingScore = useMemo(() => (lead ? computeProfilingScore(lead) : null), [lead]);

  const { data: receipts = [] } = useQuery<LeadReceiptRecord[]>({
    queryKey: ['lead-receipts', leadId],
    queryFn: () => fetch(`/api/leads/${leadId}/receipts`).then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
  });
  const [receiptDialog, setReceiptDialog] = useState<ReceiptKind | null>(null);

  const [step, setStep] = useState<number>(1);
  const [form, setForm] = useState<BasicInfoForm | null>(null);
  const [coursesForm, setCoursesForm] = useState<CoursesCollegesForm | null>(null);
  const [budgetForm, setBudgetForm] = useState<BudgetForm | null>(null);
  const [stayForm, setStayForm] = useState<StayForm | null>(null);
  const [academicsForm, setAcademicsForm] = useState<AcademicsForm | null>(null);

  const initialForm = useMemo<BasicInfoForm | null>(() => {
    if (!lead) return null;
    return {
      fullName: lead.name ?? '',
      mobile: lead.phone ?? '',
      email: lead.email ?? '',
      parentName: lead.parentName ?? '',
      parentMobile: lead.parentMobile ?? '',
      city: lead.city ?? '',
      state: lead.state ?? '',
      classYear: lead.classYear ?? '',
      gender: lead.gender ?? '',
      category: lead.category ?? '',
      correctPhone1: lead.altPhone1 ?? '',
      correctPhone2: lead.altPhone2 ?? '',
      correctEmail1: lead.altEmail1 ?? '',
      correctEmail2: lead.altEmail2 ?? '',
      correctCity: lead.correctCity ? [lead.correctCity] : [],
      correctState: lead.correctState ? [lead.correctState] : [],
    };
  }, [lead]);

  const initialCoursesForm = useMemo<CoursesCollegesForm | null>(() => {
    if (!lead) return null;
    const p = lead.profile;
    return {
      courseInterested: toStringArray(p?.preferredCourseIds),
      courseType: p?.courseType ? [p.courseType] : [],
      specialisation: p?.specialisation ?? '',
      collegeInterested: toStringArray(p?.preferredCollegeIds),
      collegeType: p?.collegeType ? [p.collegeType] : [],
      cityPreference: toStringArray(p?.preferredCityNames),
      statePreference: toStringArray(p?.preferredStateNames),
      entranceExam: toStringArray(p?.entranceExam),
    };
  }, [lead]);

  const initialBudgetForm = useMemo<BudgetForm | null>(() => {
    if (!lead) return null;
    const p = lead.profile;
    return {
      totalCourseBudget: p?.budget ? [p.budget] : [],
      scholarshipAwareness: p?.scholarshipAwareness ? [p.scholarshipAwareness] : [],
      loanRequirement: p?.loanRequirement ?? '',
      loanAmount: p?.loanAmount ? [p.loanAmount] : [],
      paymentModePreference: p?.paymentModePreference ?? '',
    };
  }, [lead]);

  const initialStayForm = useMemo<StayForm | null>(() => {
    if (!lead) return null;
    const p = lead.profile;
    return {
      stayPreference: p?.stayPreference ?? '',
      monthlyAccommodationBudget: p?.monthlyAccommodationBudget ? [p.monthlyAccommodationBudget] : [],
      roomSharing: p?.roomSharing ?? '',
      mealsPreference: p?.mealsPreference ?? '',
      keyAmenities: toStringArray(p?.keyAmenities),
      distanceWillingness: p?.distanceWillingness ?? '',
      genderHostelRequirement: p?.genderHostelRequirement ?? '',
    };
  }, [lead]);

  const initialAcademicsForm = useMemo<AcademicsForm | null>(() => {
    if (!lead) return null;
    const p = lead.profile;
    return {
      class10Percentage: p?.class10Percentage ?? '',
      class12Percentage: p?.class12Percentage ?? '',
      board: p?.board ? [p.board] : [],
      gapYearReason: p?.gapYearReason ?? '',
      mediumOfInstruction: p?.mediumOfInstruction ?? '',
    };
  }, [lead]);

  const data = form ?? initialForm;
  const coursesData = coursesForm ?? initialCoursesForm;
  const budgetData = budgetForm ?? initialBudgetForm;
  const stayData = stayForm ?? initialStayForm;
  const academicsData = academicsForm ?? initialAcademicsForm;

  function patch(updates: Partial<BasicInfoForm>) {
    if (!data) return;
    setForm({ ...data, ...updates });
  }

  function patchCourses(updates: Partial<CoursesCollegesForm>) {
    if (!coursesData) return;
    setCoursesForm({ ...coursesData, ...updates });
  }

  function patchBudget(updates: Partial<BudgetForm>) {
    if (!budgetData) return;
    setBudgetForm({ ...budgetData, ...updates });
  }

  function patchStay(updates: Partial<StayForm>) {
    if (!stayData) return;
    setStayForm({ ...stayData, ...updates });
  }

  function patchAcademics(updates: Partial<AcademicsForm>) {
    if (!academicsData) return;
    setAcademicsForm({ ...academicsData, ...updates });
  }

  const saveBasicInfoMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/leads/${leadId}/student-details`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          altPhone1: data?.correctPhone1 || null,
          altPhone2: data?.correctPhone2 || null,
          altEmail1: data?.correctEmail1 || null,
          altEmail2: data?.correctEmail2 || null,
          correctCity: data?.correctCity[0] || null,
          correctState: data?.correctState[0] || null,
          parentName: data?.parentName || null,
          parentMobile: data?.parentMobile || null,
          gender: data?.gender || null,
          classYear: data?.classYear || null,
          category: data?.category || null,
        }),
      }).then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to save');
        return json;
      }),
    onSuccess: () => {
      toast({ title: 'Basic info saved' });
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Failed to save', description: err.message });
    },
  });

  const saveCoursesMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/leads/${leadId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredCourseIds: coursesData?.courseInterested ?? [],
          preferredCollegeIds: coursesData?.collegeInterested ?? [],
          preferredCityNames: coursesData?.cityPreference ?? [],
          preferredStateNames: coursesData?.statePreference ?? [],
          courseType: coursesData?.courseType[0] || null,
          collegeType: coursesData?.collegeType[0] || null,
          specialisation: coursesData?.specialisation || null,
          entranceExam: coursesData?.entranceExam ?? [],
        }),
      }).then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to save');
        return json;
      }),
    onSuccess: () => {
      toast({ title: 'Course / college preferences saved' });
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Failed to save', description: err.message });
    },
  });

  const saveBudgetMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/leads/${leadId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          budget: budgetData?.totalCourseBudget[0] || null,
          scholarshipAwareness: budgetData?.scholarshipAwareness[0] || null,
          loanRequirement: budgetData?.loanRequirement || null,
          loanAmount: budgetData?.loanAmount[0] || null,
          paymentModePreference: budgetData?.paymentModePreference || null,
        }),
      }).then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to save');
        return json;
      }),
    onSuccess: () => {
      toast({ title: 'Budget details saved' });
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Failed to save', description: err.message });
    },
  });

  const saveStayMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/leads/${leadId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stayPreference: stayData?.stayPreference || null,
          monthlyAccommodationBudget: stayData?.monthlyAccommodationBudget[0] || null,
          roomSharing: stayData?.roomSharing || null,
          mealsPreference: stayData?.mealsPreference || null,
          keyAmenities: stayData?.keyAmenities ?? [],
          distanceWillingness: stayData?.distanceWillingness || null,
          genderHostelRequirement: stayData?.genderHostelRequirement || null,
        }),
      }).then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to save');
        return json;
      }),
    onSuccess: () => {
      toast({ title: 'Accommodation preferences saved' });
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Failed to save', description: err.message });
    },
  });

  const saveAcademicsMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/leads/${leadId}/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          class10Percentage: academicsData?.class10Percentage || null,
          class12Percentage: academicsData?.class12Percentage || null,
          board: academicsData?.board[0] || null,
          gapYearReason: academicsData?.gapYearReason || null,
          mediumOfInstruction: academicsData?.mediumOfInstruction || null,
        }),
      }).then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to save');
        return json;
      }),
    onSuccess: () => {
      toast({ title: 'Academic details saved' });
      qc.invalidateQueries({ queryKey: ['lead-detail', leadId] });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Failed to save', description: err.message });
    },
  });

  async function handleBasicInfoNext() {
    try {
      await saveBasicInfoMutation.mutateAsync();
      setStep(2);
    } catch {
      // error toast already shown via onError
    }
  }

  async function handleCoursesNext() {
    try {
      await saveCoursesMutation.mutateAsync();
      setStep(3);
    } catch {
      // error toast already shown via onError
    }
  }

  async function handleBudgetNext() {
    try {
      await saveBudgetMutation.mutateAsync();
      setStep(4);
    } catch {
      // error toast already shown via onError
    }
  }

  async function handleStayNext() {
    try {
      await saveStayMutation.mutateAsync();
      setStep(5);
    } catch {
      // error toast already shown via onError
    }
  }

  async function handleAcademicsNext() {
    try {
      await saveAcademicsMutation.mutateAsync();
      setStep(6);
    } catch {
      // error toast already shown via onError
    }
  }

  if (isLoading || !lead || !data || !coursesData || !budgetData || !stayData || !academicsData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-20 flex h-14 sm:h-16 items-center justify-between border-b bg-background px-3 sm:px-6 shadow-sm">
        <div className="flex items-center gap-3">
          <svg width="28" height="24" viewBox="0 0 30 26" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0">
            <path d="M18 0L7 13L18 26H24L13 13L24 0H18Z" fill="#E85A42" />
            <path d="M9 0L0 13L9 26H15L6 13L15 0H9Z" fill="#E85A42" opacity="0.55" />
          </svg>
          <div className="leading-tight">
            <p className="font-bold text-[15px] tracking-tight text-foreground">KollegeApply</p>
            <p className="text-[10px] text-muted-foreground tracking-wide">Empowering Education</p>
          </div>
          <span className="mx-2.5 hidden h-7 w-px bg-border sm:block" />
          <div className="hidden leading-tight sm:block">
            <p className="text-sm font-semibold text-foreground">Lead Profile</p>
            <p className="text-xs text-muted-foreground">{lead.name} &middot; {lead.id}</p>
          </div>
        </div>
        <button
          onClick={() => {
            // Opened in a new tab (drawer's "View Lead Profile") → close the tab.
            // Reached by in-tab navigation (global search) → window.close() is
            // blocked by the browser, so go back to the previous page instead.
            if (window.history.length > 1) router.back();
            else window.close();
          }}
          className="flex items-center gap-1.5 rounded-lg border border-input px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-sm transition-all duration-150 hover:bg-muted/50 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Close
        </button>
      </header>

      <div className="px-3 py-3 sm:px-6 sm:py-8">
        {/* Mobile: horizontal step navigation pills (replaces the desktop stepper) */}
        <div className="lg:hidden overflow-x-auto [&::-webkit-scrollbar]:hidden pb-1 mb-3">
          <div className="flex gap-1.5 min-w-max">
            {STEPS.map(({ key, quickLabel, Icon }) => (
              <button
                key={key}
                onClick={() => setStep(key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium whitespace-nowrap transition-all duration-200 ease-premium active:scale-95',
                  step === key
                    ? 'bg-primary text-primary-foreground border-primary shadow-sm shadow-primary/25 scale-105'
                    : step > key
                    ? 'bg-primary/10 border-primary/20 text-primary'
                    : 'border-input bg-background text-muted-foreground',
                )}
              >
                {step > key ? <Check className="h-2.5 w-2.5" /> : <Icon className="h-2.5 w-2.5" />}
                {quickLabel}
              </button>
            ))}
          </div>
        </div>
        <div className="mx-auto grid max-w-6xl grid-cols-1 lg:grid-cols-[280px_1fr] gap-4 lg:gap-6">
        {/* ── Left sidebar ─────────────────────────────────────── */}
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-background p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {getInitials(lead.name)}
              </div>
              <div>
                <p className="text-sm font-bold leading-tight">{lead.name}</p>
                <p className="text-xs text-muted-foreground">{lead.phone}</p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={`tel:${lead.phone}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[#0e4164] px-3 text-xs font-medium text-white shadow-sm transition-colors hover:bg-[#0c3755]"
              >
                <Phone className="h-3.5 w-3.5" /> Call
              </a>
              <WhatsAppButton phone={lead.phone} leadName={lead.name} course={lead.course} />
            </div>

            <dl className="hidden sm:block space-y-1.5 border-t border-border/60 pt-3">
              <SidebarRow label="Lead Name" value={lead.name} />
              <SidebarRow label="Email" value={lead.email} />
              <SidebarRow label="Phone" value={lead.phone} />
              <SidebarRow label="City" value={lead.city} />
              <SidebarRow label="State" value={lead.state} />
              <SidebarRow label="College" value={lead.college} />
              <SidebarRow label="Course" value={lead.course} />
            </dl>
          </div>

          {profilingScore && <ProfileCompletionCard score={profilingScore} onJumpToStep={setStep} />}

          <div className="hidden lg:block rounded-xl border border-border bg-background p-3 space-y-1.5">
            <p className="px-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Quick Actions</p>
            {STEPS.map(({ key, quickLabel, Icon }) => (
              <button
                key={key}
                onClick={() => setStep(key)}
                className={cn(
                  'group/qa flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium transition-all duration-200 ease-premium hover:translate-x-0.5',
                  step === key ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50 text-foreground'
                )}
              >
                <Icon className="h-4 w-4 shrink-0 transition-transform duration-200 ease-premium group-hover/qa:scale-110" />
                {quickLabel}
              </button>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-background p-3 space-y-2.5">
            <div className="flex items-center gap-1.5 px-1">
              <span className="h-2 w-2 rounded-full bg-blue-500" />
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Receipts</p>
            </div>
            <ReceiptCard
              leadId={leadId}
              label="Application Receipt Upload"
              kind="APPLICATION"
              receipts={receipts.filter((r) => r.type === 'APPLICATION')}
              onUpload={() => setReceiptDialog('APPLICATION')}
            />
            <ReceiptCard
              leadId={leadId}
              label="Admission Receipt Upload"
              kind="ADMISSION"
              receipts={receipts.filter((r) => r.type === 'ADMISSION')}
              onUpload={() => setReceiptDialog('ADMISSION')}
            />
          </div>
        </div>

        {/* ── Right panel ───────────────────────────────────────── */}
        <div className="space-y-6">
          {/* Stepper — desktop only; mobile uses the pill nav above */}
          <div className="hidden lg:block rounded-xl border border-border bg-background p-5">
            <div className="flex items-center">
              {STEPS.map(({ key, label }, i) => (
                <div key={key} className="flex flex-1 items-center last:flex-none">
                  <button onClick={() => setStep(key)} className="group/step flex flex-col items-center gap-1.5">
                    <div className={cn(
                      'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ease-premium group-hover/step:scale-110',
                      step === key
                        ? 'bg-primary text-primary-foreground scale-110 shadow-md shadow-primary/30 ring-4 ring-primary/15'
                        : step > key
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground'
                    )}>
                      {step > key ? <Check className="h-4 w-4 animate-scale-in" /> : key}
                    </div>
                    <span className={cn(
                      'text-[11px] font-medium whitespace-nowrap',
                      step === key ? 'text-primary font-bold' : 'text-muted-foreground'
                    )}>
                      {label}
                    </span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={cn('mx-2 h-px flex-1', step > key ? 'bg-primary/40' : 'bg-border')} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Step content — keyed so each step fades in when switched */}
          <div key={step} className="animate-fade-in-up">
          {step === 1 ? (
            <BasicInfoStep
              data={data}
              onChange={patch}
              onNext={handleBasicInfoNext}
              isSaving={saveBasicInfoMutation.isPending}
            />
          ) : step === 2 ? (
            <CoursesCollegesStep
              data={coursesData}
              onChange={patchCourses}
              onBack={() => setStep(1)}
              onNext={handleCoursesNext}
              isSaving={saveCoursesMutation.isPending}
            />
          ) : step === 3 ? (
            <BudgetStep
              data={budgetData}
              onChange={patchBudget}
              onBack={() => setStep(2)}
              onNext={handleBudgetNext}
              isSaving={saveBudgetMutation.isPending}
            />
          ) : step === 4 ? (
            <StayStep
              data={stayData}
              onChange={patchStay}
              onBack={() => setStep(3)}
              onNext={handleStayNext}
              isSaving={saveStayMutation.isPending}
            />
          ) : step === 5 ? (
            <AcademicsStep
              data={academicsData}
              onChange={patchAcademics}
              onBack={() => setStep(4)}
              onNext={handleAcademicsNext}
              isSaving={saveAcademicsMutation.isPending}
            />
          ) : step === 6 ? (
            <SummaryStep
              basicInfo={data}
              courses={coursesData}
              budget={budgetData}
              stay={stayData}
              academics={academicsData}
              onBack={() => setStep(5)}
              onEditStep={setStep}
            />
          ) : (
            <PlaceholderStep
              step={STEPS.find((s) => s.key === step)!}
              onBack={() => setStep(step - 1)}
              onNext={() => setStep(Math.min(step + 1, STEPS.length))}
              isLast={step === STEPS.length}
            />
          )}
          </div>

          {/* Referrals — visible on every step */}
          <ReferralsSection leadId={leadId} />
        </div>
      </div>
      </div>

      <ReceiptUploadDialog
        leadId={leadId}
        kind={receiptDialog ?? 'APPLICATION'}
        open={receiptDialog !== null}
        onOpenChange={(o) => setReceiptDialog(o ? receiptDialog : null)}
        agentName={agentName}
        lead={lead}
      />
    </div>
  );
}

// Per-receipt-type colour tones — Application is blue, Admission is green.
// Kept as full literal class strings so Tailwind's scanner picks them up.
const RECEIPT_TONES: Record<ReceiptKind, {
  container: string; button: string; iconChip: string; link: string; empty: string; check: string;
}> = {
  APPLICATION: {
    container: 'border-blue-200 bg-gradient-to-br from-blue-50 to-sky-50/40 dark:border-blue-900/60 dark:from-blue-950/40 dark:to-sky-950/20',
    button: 'bg-blue-100/70 text-blue-800 hover:bg-blue-200/70 dark:bg-blue-900/40 dark:text-blue-200 dark:hover:bg-blue-900/60',
    iconChip: 'bg-blue-600 text-white shadow-sm shadow-blue-600/30',
    link: 'text-blue-700 hover:text-blue-800 dark:text-blue-300',
    empty: 'text-blue-500/70 dark:text-blue-300/60',
    check: 'text-blue-600 dark:text-blue-400',
  },
  ADMISSION: {
    container: 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50/40 dark:border-emerald-900/60 dark:from-emerald-950/40 dark:to-teal-950/20',
    button: 'bg-emerald-100/70 text-emerald-800 hover:bg-emerald-200/70 dark:bg-emerald-900/40 dark:text-emerald-200 dark:hover:bg-emerald-900/60',
    iconChip: 'bg-emerald-600 text-white shadow-sm shadow-emerald-600/30',
    link: 'text-emerald-700 hover:text-emerald-800 dark:text-emerald-300',
    empty: 'text-emerald-600/70 dark:text-emerald-300/60',
    check: 'text-emerald-600 dark:text-emerald-400',
  },
};

const RECEIPT_STATUS_META = {
  PENDING: { Icon: Clock3, label: 'Pending review', tone: 'text-amber-600 dark:text-amber-400' },
  APPROVED: { Icon: CheckCircle2, label: 'Approved', tone: 'text-emerald-600 dark:text-emerald-400' },
  DISAPPROVED: { Icon: XCircle, label: 'Disapproved', tone: 'text-red-600 dark:text-red-400' },
} as const;

function ReceiptCard({
  leadId, label, kind, receipts, onUpload,
}: { leadId: string; label: string; kind: ReceiptKind; receipts: LeadReceiptRecord[]; onUpload: () => void }) {
  const t = RECEIPT_TONES[kind];
  // Receipts arrive newest-first — the most recent one governs what the
  // header button offers next (upload / wait / resend / done).
  const latest = receipts[0];

  return (
    <div className={cn('rounded-lg border-2 p-2.5 space-y-2 shadow-sm', t.container)}>
      {!latest || latest.status === 'DISAPPROVED' ? (
        <button
          type="button"
          onClick={onUpload}
          className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-left text-xs font-bold transition-colors', t.button)}
        >
          <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', t.iconChip)}>
            <Receipt className="h-3.5 w-3.5" />
          </span>
          {latest?.status === 'DISAPPROVED' ? `Resend ${label}` : label}
        </button>
      ) : (
        <div className={cn('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-xs font-bold', t.button)}>
          <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', t.iconChip)}>
            <Receipt className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1">{label}</span>
          {latest.status === 'PENDING' ? (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
              <Clock3 className="h-3 w-3" /> Awaiting approval
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Confirmed
            </span>
          )}
        </div>
      )}

      {latest?.status === 'DISAPPROVED' && latest.disapprovalReason && (
        <p className="rounded-md border border-red-200/60 bg-red-500/5 px-2 py-1.5 text-[11px] text-red-700 dark:border-red-900/40 dark:text-red-400">
          <strong>Disapproved:</strong> {latest.disapprovalReason}
        </p>
      )}

      {receipts.length > 0 ? (
        <ul className="space-y-1.5">
          {receipts.map((r, i) => {
            const s = RECEIPT_STATUS_META[r.status];
            return (
              <li key={r.id} className="flex items-center justify-between gap-2 px-1 text-[11px]">
                <span className={cn('flex min-w-0 items-center gap-1 font-medium', s.tone)}>
                  <s.Icon className="h-3 w-3 shrink-0" />
                  <span className="shrink-0">#{receipts.length - i}</span>
                  <span className="truncate text-muted-foreground">
                    &middot; {new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </span>
                </span>
                <a
                  href={`/api/leads/${leadId}/receipts/${r.id}/file`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn('flex shrink-0 items-center gap-1 font-medium hover:underline', t.link)}
                >
                  View <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={cn('px-1 text-[11px] font-medium', t.empty)}>Not uploaded yet</p>
      )}
    </div>
  );
}

function SidebarRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value || '—'}</dd>
    </div>
  );
}

// ─── Profile Completeness ──────────────────────────────────────────────────────

function ProfileCompletionCard({
  score, onJumpToStep,
}: { score: ReturnType<typeof computeProfilingScore>; onJumpToStep: (step: number) => void }) {
  const [expanded, setExpanded] = useState(false);
  const tone = profilingScoreTone(score.percentage);

  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score.percentage / 100) * circumference;

  return (
    <div className="rounded-xl border border-border bg-background p-4 space-y-3 animate-fade-in-up">
      <div className="flex items-center gap-3">
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
          <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
            <circle cx="32" cy="32" r={radius} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted/40" />
            <circle
              cx="32" cy="32" r={radius} fill="none" stroke={tone.ring} strokeWidth="6" strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.22, 1, 0.36, 1)' }}
            />
          </svg>
          <span className={cn('absolute text-sm font-extrabold tabular-nums', tone.text)}>{score.percentage}%</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight">Profile Completeness</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {score.filled}/{score.total} fields filled
          </p>
        </div>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full rounded-full transition-all duration-700 ease-premium', tone.bar)}
          style={{ width: `${score.percentage}%` }}
        />
      </div>

      {score.missingFields.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex w-full items-center justify-between text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>{score.missingFields.length} field{score.missingFields.length > 1 ? 's' : ''} remaining</span>
            <ChevronDown className={cn('h-3 w-3 transition-transform duration-200', expanded && 'rotate-180')} />
          </button>
          {expanded && (
            <div className="mt-2 flex flex-wrap gap-1.5 animate-fade-in-up">
              {score.missingFields.map((m) => (
                <button
                  key={m.label}
                  type="button"
                  onClick={() => onJumpToStep(STEP_BY_NAME[m.step] ?? 1)}
                  className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-all duration-150 hover:-translate-y-0.5 hover:text-foreground hover:shadow-sm"
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className={cn('flex items-center gap-1.5 text-[11px] font-semibold', tone.text)}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Fully profiled
        </p>
      )}
    </div>
  );
}

// ─── Referrals ────────────────────────────────────────────────────────────────

interface ReferralIntegrationLog {
  id: string;
  success: boolean;
  isTest: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
  requestUrl: string;
  requestBody: string;
  attemptedAt: string;
  integration: { name: string };
}

interface ReferralRecord {
  id: string;
  name: string;
  email: string;
  phone: string;
  city?: string | null;
  state?: string | null;
  course?: string | null;
  college?: string | null;
  createdAt: string;
  assignedTo?: { id: string; name: string } | null;
  integrationLogs: ReferralIntegrationLog[];
}

interface ReferralForm {
  name: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  courseId: string;
  collegeId: string;
  category: string;
}

const EMPTY_REFERRAL: ReferralForm = {
  name: '', email: '', phone: '', city: '', state: '', courseId: '', collegeId: '', category: '',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function ReferralsSection({ leadId }: { leadId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ReferralForm>(EMPTY_REFERRAL);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof ReferralForm, string>>>({});

  const { data: referrals = [] } = useQuery<ReferralRecord[]>({
    queryKey: ['lead-referrals', leadId],
    queryFn: () => fetch(`/api/leads/${leadId}/referrals`).then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
  });

  const { stateOptions, cityOptions } = useLocationOptions();
  const cityOpts = useMemo(() => toOptionsFromStatic(cityOptions), [cityOptions]);
  const stateOpts = useMemo(() => toOptionsFromStatic(stateOptions), [stateOptions]);

  const { data: coursesData = [] } = useQuery<StaticOption[]>({
    queryKey: ['courses'],
    queryFn: () => fetch('/api/courses').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });
  const { data: collegesData = [] } = useQuery<StaticOption[]>({
    queryKey: ['colleges'],
    queryFn: () => fetch('/api/colleges').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });
  const courseOpts = useMemo(() => toOptionsFromStatic(coursesData), [coursesData]);
  const collegeOpts = useMemo(() => toOptionsFromStatic(collegesData), [collegesData]);

  function patchForm(updates: Partial<ReferralForm>) {
    setForm((f) => ({ ...f, ...updates }));
    // Clear the error of any field being edited
    setFieldErrors((e) => {
      const next = { ...e };
      (Object.keys(updates) as (keyof ReferralForm)[]).forEach((k) => delete next[k]);
      return next;
    });
  }

  function validate(): boolean {
    const errors: Partial<Record<keyof ReferralForm, string>> = {};
    if (form.name.trim().length < 2) errors.name = 'Name must be at least 2 characters';
    if (!EMAIL_RE.test(form.email.trim())) errors.email = 'Enter a valid email address';
    if (!/^\d{10}$/.test(form.phone)) errors.phone = 'Phone must be exactly 10 digits';
    if (!form.city) errors.city = 'Select a city';
    if (!form.state) errors.state = 'Select a state';
    if (!form.courseId) errors.courseId = 'Select a course';
    if (!form.collegeId) errors.collegeId = 'Select a college';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  const addReferralMutation = useMutation({
    mutationFn: () =>
      fetch(`/api/leads/${leadId}/referrals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone,
          city: form.city,
          state: form.state,
          course: courseOpts.find((o) => o.value === form.courseId)?.label ?? form.courseId,
          college: collegeOpts.find((o) => o.value === form.collegeId)?.label ?? form.collegeId,
          kappCollegeId: form.collegeId,
          category: form.category || undefined,
        }),
      }).then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(typeof json.error === 'string' ? json.error : 'Failed to add referral');
        return json;
      }),
    onSuccess: (created: ReferralRecord) => {
      toast({
        title: 'Referral added',
        description: `${created.name} is now in All Leads and assigned to you.`,
      });
      setForm(EMPTY_REFERRAL);
      setFieldErrors({});
      setShowForm(false);
      qc.invalidateQueries({ queryKey: ['lead-referrals', leadId] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: Error) => {
      toast({ variant: 'destructive', title: 'Failed to add referral', description: err.message });
    },
  });

  function handleSubmit() {
    if (!validate()) return;
    addReferralMutation.mutate();
  }

  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <div className="flex items-center justify-between gap-3 rounded-t-xl bg-primary/5 px-4 sm:px-5 py-3.5 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Users className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold">Referrals</h2>
            <p className="text-xs text-muted-foreground">
              {referrals.length === 0
                ? 'People this lead referred for admission'
                : `${referrals.length} referral${referrals.length > 1 ? 's' : ''} added from this lead`}
            </p>
          </div>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add Referral
          </button>
        )}
      </div>

      {/* Existing referrals */}
      {referrals.length > 0 && (
        <ul className="divide-y divide-border/60">
          {referrals.map((r, i) => (
            <li
              key={r.id}
              className="flex flex-col gap-1 px-4 sm:px-5 py-3 animate-fade-in-up transition-colors hover:bg-muted/30"
              style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-[13px] font-bold">{r.name}</span>
                <span className="rounded bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {r.id}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Phone className="h-3 w-3" /> {r.phone}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                {[r.course, r.college].filter(Boolean).join(' · ') || '—'}
                {(r.city || r.state) && <> &middot; {[r.city, r.state].filter(Boolean).join(', ')}</>}
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                Assigned to {r.assignedTo?.name ?? '—'} &middot; {new Date(r.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
              </p>
              <ReferralPushStatus logs={r.integrationLogs} />
            </li>
          ))}
        </ul>
      )}

      {referrals.length === 0 && !showForm && (
        <p className="px-4 sm:px-5 py-4 text-xs text-muted-foreground">
          No referrals yet. If this lead knows someone who also wants admission, add them here —
          they&apos;ll be created as a new lead and assigned to you automatically.
        </p>
      )}

      {/* Add referral form */}
      {showForm && (
        <div className="border-t border-border px-4 sm:px-5 py-4 space-y-3.5 animate-fade-in-up">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 items-start">
            <div className="space-y-1.5">
              <label className={LABEL_CLASS}>Full Name <span className="text-destructive">*</span></label>
              <input
                value={form.name}
                onChange={(e) => patchForm({ name: e.target.value })}
                placeholder="Referral's full name"
                className={INPUT_CLASS}
              />
              {fieldErrors.name && <p className="text-[11px] text-destructive">{fieldErrors.name}</p>}
            </div>

            <div className="space-y-1.5">
              <label className={LABEL_CLASS}>Email <span className="text-destructive">*</span></label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => patchForm({ email: e.target.value })}
                placeholder="referral@email.com"
                className={INPUT_CLASS}
              />
              {fieldErrors.email && <p className="text-[11px] text-destructive">{fieldErrors.email}</p>}
            </div>

            <div className="space-y-1.5">
              <label className={LABEL_CLASS}>Phone <span className="text-destructive">*</span></label>
              <input
                type="tel"
                inputMode="numeric"
                value={form.phone}
                onChange={(e) => patchForm({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
                placeholder="10-digit mobile number"
                className={INPUT_CLASS}
              />
              {fieldErrors.phone && <p className="text-[11px] text-destructive">{fieldErrors.phone}</p>}
            </div>

            <div className="space-y-1.5">
              <label className={LABEL_CLASS}>City <span className="text-destructive">*</span></label>
              <MultiSelect
                options={cityOpts}
                selected={form.city ? [form.city] : []}
                onChange={(v) => patchForm({ city: v[v.length - 1] ?? '' })}
                placeholder="Select city"
              />
              {fieldErrors.city && <p className="text-[11px] text-destructive">{fieldErrors.city}</p>}
            </div>

            <div className="space-y-1.5">
              <label className={LABEL_CLASS}>State <span className="text-destructive">*</span></label>
              <MultiSelect
                options={stateOpts}
                selected={form.state ? [form.state] : []}
                onChange={(v) => patchForm({ state: v[v.length - 1] ?? '' })}
                placeholder="Select state"
              />
              {fieldErrors.state && <p className="text-[11px] text-destructive">{fieldErrors.state}</p>}
            </div>

            <div className="space-y-1.5">
              <label className={LABEL_CLASS}>Course Looking For <span className="text-destructive">*</span></label>
              <MultiSelect
                options={courseOpts}
                selected={form.courseId ? [form.courseId] : []}
                onChange={(v) => patchForm({ courseId: v[v.length - 1] ?? '' })}
                placeholder="Select course"
              />
              {fieldErrors.courseId && <p className="text-[11px] text-destructive">{fieldErrors.courseId}</p>}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className={LABEL_CLASS}>College Looking For <span className="text-destructive">*</span></label>
              <MultiSelect
                options={collegeOpts}
                selected={form.collegeId ? [form.collegeId] : []}
                onChange={(v) => patchForm({ collegeId: v[v.length - 1] ?? '' })}
                placeholder="Select college"
              />
              {fieldErrors.collegeId && <p className="text-[11px] text-destructive">{fieldErrors.collegeId}</p>}
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className={LABEL_CLASS}>Category</label>
              <PillGroup options={CATEGORY_OPTIONS} value={form.category} onChange={(v) => patchForm({ category: v })} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => { setShowForm(false); setForm(EMPTY_REFERRAL); setFieldErrors({}); }}
              className="rounded-lg border border-input px-3.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={addReferralMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
            >
              {addReferralMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save Referral
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact LMS push status for one referral, expandable to the full request/response the integration sent. */
function ReferralPushStatus({ logs }: { logs: ReferralIntegrationLog[] }) {
  const [expanded, setExpanded] = useState(false);
  const latest = logs[0];

  if (!latest) {
    return (
      <p className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
        <Webhook className="h-3 w-3" /> Not pushed to any external system yet
      </p>
    );
  }

  return (
    <div className="text-[11px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        {latest.success ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
        ) : (
          <XCircle className="h-3 w-3 text-red-600" />
        )}
        Pushed to {latest.integration.name}
        {latest.isTest && <span className="rounded border border-border px-1 py-0 text-[9px] font-semibold">TEST</span>}
        &middot; {latest.success ? `HTTP ${latest.responseStatus}` : latest.errorMessage ?? 'Failed'}
        &middot; {new Date(latest.attemptedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
          {logs.map((log) => (
            <div key={log.id} className="space-y-1 border-b border-border/40 pb-2 last:border-0 last:pb-0">
              <p className="flex items-center gap-1 font-semibold text-muted-foreground">
                {log.success ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                ) : (
                  <XCircle className="h-3 w-3 text-red-600" />
                )}
                {new Date(log.attemptedAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                {log.isTest && <span className="rounded border border-border px-1 py-0 text-[9px]">TEST</span>}
              </p>
              <p className="break-all font-mono text-[10px] text-muted-foreground">{log.requestUrl}</p>
              <pre className="max-h-32 overflow-auto rounded bg-background/60 p-1.5 font-mono text-[10px]">
                {log.responseBody ?? log.errorMessage ?? 'No response'}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step 1: Basic Info ───────────────────────────────────────────────────────

function BasicInfoStep({
  data, onChange, onNext, isSaving,
}: {
  data: BasicInfoForm;
  onChange: (updates: Partial<BasicInfoForm>) => void;
  onNext: () => void;
  isSaving?: boolean;
}) {
  const { stateOptions, cityOptions } = useLocationOptions();
  const cityOpts = useMemo(() => toOptionsFromStatic(cityOptions), [cityOptions]);
  const stateOpts = useMemo(() => toOptionsFromStatic(stateOptions), [stateOptions]);

  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <StepHeader Icon={GraduationCap} title="Basic Student Info" subtitle="Personal & contact details of the student" step={1} />

      <div className="divide-y divide-border">
        <Section title="Personal Information">
          <Field label="Name">
            <input className={DISABLED_INPUT_CLASS} value={data.fullName} disabled readOnly />
          </Field>
          <Field label="Phone">
            <input className={DISABLED_INPUT_CLASS} value={data.mobile} disabled readOnly />
          </Field>
          <Field label="Email">
            <input type="email" className={DISABLED_INPUT_CLASS} value={data.email} disabled readOnly />
          </Field>
          <Field label="Parent / Guardian Name">
            <input className={INPUT_CLASS} placeholder="Father / Mother name" value={data.parentName}
              onChange={(e) => onChange({ parentName: e.target.value })} />
          </Field>
          <Field label="Parent Mobile">
            <input className={INPUT_CLASS} placeholder="+91" value={data.parentMobile}
              onChange={(e) => onChange({ parentMobile: e.target.value })} />
          </Field>
          <Field label="Gender">
            <PillGroup options={GENDER_OPTIONS} value={data.gender} onChange={(v) => onChange({ gender: v })} />
          </Field>
          <Field label="Category">
            <PillGroup options={CATEGORY_OPTIONS} value={data.category} onChange={(v) => onChange({ category: v })} />
          </Field>
          <Field label="City">
            <input className={DISABLED_INPUT_CLASS} value={data.city} disabled readOnly />
          </Field>
          <Field label="State">
            <input className={DISABLED_INPUT_CLASS} value={data.state} disabled readOnly />
          </Field>
        </Section>

        <Section title="Education">
          <FullRow>
            <Field label="Current Class / Year">
              <PillGroup options={CLASS_YEAR_OPTIONS} value={data.classYear} onChange={(v) => onChange({ classYear: v })} />
            </Field>
          </FullRow>
        </Section>

        <Section title="Correction" subtitle="Use this if the original details captured for the lead were incorrect">
          <Field label="Correct Phone Number 1">
            <input className={INPUT_CLASS} placeholder="10-digit number" value={data.correctPhone1}
              onChange={(e) => onChange({ correctPhone1: e.target.value })} />
          </Field>
          <Field label="Correct Phone Number 2">
            <input className={INPUT_CLASS} placeholder="10-digit number" value={data.correctPhone2}
              onChange={(e) => onChange({ correctPhone2: e.target.value })} />
          </Field>
          <Field label="Correct Email Address 1">
            <input type="email" className={INPUT_CLASS} placeholder="email@example.com" value={data.correctEmail1}
              onChange={(e) => onChange({ correctEmail1: e.target.value })} />
          </Field>
          <Field label="Correct Email Address 2">
            <input type="email" className={INPUT_CLASS} placeholder="email@example.com" value={data.correctEmail2}
              onChange={(e) => onChange({ correctEmail2: e.target.value })} />
          </Field>
          <Field label="Correct City">
            <MultiSelect
              options={cityOpts}
              selected={data.correctCity}
              onChange={(v) => onChange({ correctCity: v })}
              placeholder="— Select City —"
            />
          </Field>
          <Field label="Correct State">
            <MultiSelect
              options={stateOpts}
              selected={data.correctState}
              onChange={(v) => onChange({ correctState: v })}
              placeholder="— Select State —"
            />
          </Field>
        </Section>
      </div>

      <StepFooter onNext={onNext} nextLabel="Next: Preferences →" isSaving={isSaving} />
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="px-4 sm:px-5 py-4">
      <div className="mb-3.5 flex items-center gap-3">
        <p className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-primary/80">{title}</p>
        <span className="h-px flex-1 bg-border/70" />
      </div>
      {subtitle && <p className="-mt-2 mb-3 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4 items-start">
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className={LABEL_CLASS}>{label}</label>
      {children}
    </div>
  );
}

// Full-width row inside a Section grid — used for pill groups and card selects
// so they never sit squeezed next to a dropdown in a half-width column.
function FullRow({ children }: { children: React.ReactNode }) {
  return <div className="sm:col-span-2">{children}</div>;
}

function StepHeader({
  Icon, title, subtitle, step,
}: {
  Icon: typeof GraduationCap;
  title: string;
  subtitle: string;
  step?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-t-xl bg-primary/5 px-4 sm:px-5 py-3.5 border-b border-border">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{title}</p>
          <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {step !== undefined && (
        <span className="hidden sm:inline-flex shrink-0 items-center rounded-full border border-primary/20 bg-primary/10 px-2.5 py-1 text-[10px] font-bold text-primary whitespace-nowrap">
          Step {step} of {STEPS.length}
        </span>
      )}
    </div>
  );
}

function StepFooter({
  onBack, onNext, nextLabel, isSaving,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  isSaving?: boolean;
}) {
  return (
    <div className={cn('flex items-center border-t border-border px-4 sm:px-5 py-3.5', onBack ? 'justify-between' : 'justify-end')}>
      {onBack && (
        <button
          onClick={onBack}
          className="rounded-lg border border-input px-4 py-2 text-sm font-semibold shadow-sm transition-all duration-150 hover:bg-muted/50 hover:shadow active:scale-[0.98]"
        >
          ← Back
        </button>
      )}
      {onNext && (
        <button
          onClick={onNext}
          disabled={isSaving}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-150 hover:bg-primary/90 hover:shadow active:scale-[0.98] disabled:opacity-60"
        >
          {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {nextLabel}
        </button>
      )}
    </div>
  );
}

// ─── Step 2: Courses / Colleges ────────────────────────────────────────────────

function CoursesCollegesStep({
  data, onChange, onBack, onNext, isSaving,
}: {
  data: CoursesCollegesForm;
  onChange: (updates: Partial<CoursesCollegesForm>) => void;
  onBack: () => void;
  onNext: () => void;
  isSaving?: boolean;
}) {
  const { data: coursesData = [] } = useQuery<StaticOption[]>({
    queryKey: ['static-courses'],
    queryFn: () => fetch('/api/courses').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });

  const { data: collegesData = [] } = useQuery<StaticOption[]>({
    queryKey: ['static-colleges'],
    queryFn: () => fetch('/api/colleges').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });

  const { stateOptions, cityOptions } = useLocationOptions();

  const courseOpts = useMemo(() => toOptionsFromStatic(coursesData), [coursesData]);
  const collegeOpts = useMemo(() => toOptionsFromStatic(collegesData), [collegesData]);
  const cityOpts = useMemo(() => toOptionsFromStatic(cityOptions), [cityOptions]);
  const stateOpts = useMemo(() => toOptionsFromStatic(stateOptions), [stateOptions]);

  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <StepHeader Icon={Landmark} title="Course / College Preferences" subtitle="What the student is interested in studying & where" step={2} />

      <div className="divide-y divide-border">
        <Section title="Course Preferences">
          <Field label="Course(s) Interested In">
            <MultiSelect options={courseOpts} selected={data.courseInterested} onChange={(v) => onChange({ courseInterested: v })} placeholder="— Select Course —" />
          </Field>
          <Field label="Preferred Course Type">
            <MultiSelect options={COURSE_TYPE_OPTIONS} selected={data.courseType} onChange={(v) => onChange({ courseType: v })} placeholder="— Select Type —" />
          </Field>
          <Field label="Specialisation / Branch Interest">
            <input className={INPUT_CLASS} placeholder="e.g. Computer Science, Finance" value={data.specialisation}
              onChange={(e) => onChange({ specialisation: e.target.value })} />
          </Field>
          <Field label="Entrance Exams Appeared / Planning">
            <MultiSelect options={ENTRANCE_EXAM_OPTIONS} selected={data.entranceExam} onChange={(v) => onChange({ entranceExam: v })} placeholder="— Select Exam —" />
          </Field>
        </Section>

        <Section title="College & Location Preferences">
          <Field label="College(s) Interested In">
            <MultiSelect options={collegeOpts} selected={data.collegeInterested} onChange={(v) => onChange({ collegeInterested: v })} placeholder="— Select College —" />
          </Field>
          <Field label="Preferred College Type">
            <MultiSelect options={COLLEGE_TYPE_OPTIONS} selected={data.collegeType} onChange={(v) => onChange({ collegeType: v })} placeholder="— Select Type —" />
          </Field>
          <Field label="City Preference">
            <MultiSelect options={cityOpts} selected={data.cityPreference} onChange={(v) => onChange({ cityPreference: v })} placeholder="— Select City —" />
          </Field>
          <Field label="State Preference">
            <MultiSelect options={stateOpts} selected={data.statePreference} onChange={(v) => onChange({ statePreference: v })} placeholder="— Select State —" />
          </Field>
        </Section>
      </div>

      <StepFooter onBack={onBack} onNext={onNext} nextLabel="Next: Budget →" isSaving={isSaving} />
    </div>
  );
}

// ─── Step 3: Budget ─────────────────────────────────────────────────────────────

function BudgetStep({
  data, onChange, onBack, onNext, isSaving,
}: {
  data: BudgetForm;
  onChange: (updates: Partial<BudgetForm>) => void;
  onBack: () => void;
  onNext: () => void;
  isSaving?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <StepHeader Icon={Wallet} title="Budget & Finance" subtitle="Affordability, scholarships & loan needs" step={3} />

      <div className="divide-y divide-border">
        <Section title="Affordability">
          <Field label="Total Course Budget (All Years)">
            <MultiSelect options={BUDGET_RANGE_OPTIONS} selected={data.totalCourseBudget} onChange={(v) => onChange({ totalCourseBudget: v })} placeholder="— Select Range —" />
          </Field>
          <Field label="Scholarship Awareness">
            <MultiSelect options={SCHOLARSHIP_OPTIONS} selected={data.scholarshipAwareness} onChange={(v) => onChange({ scholarshipAwareness: v })} placeholder="— Select —" />
          </Field>
        </Section>

        <Section title="Education Loan">
          <FullRow>
            <Field label="Loan Requirement">
              <CardSelect options={LOAN_REQUIREMENT_OPTIONS} value={data.loanRequirement} onChange={(v) => onChange({ loanRequirement: v })} />
            </Field>
          </FullRow>
          <Field label="Loan Amount Required (Approx)">
            <MultiSelect options={LOAN_AMOUNT_OPTIONS} selected={data.loanAmount} onChange={(v) => onChange({ loanAmount: v })} placeholder="— Select Amount —" />
          </Field>
        </Section>

        <Section title="Payment">
          <FullRow>
            <Field label="Payment Mode Preference">
              <PillGroup options={PAYMENT_MODE_OPTIONS} value={data.paymentModePreference} onChange={(v) => onChange({ paymentModePreference: v })} />
            </Field>
          </FullRow>
        </Section>
      </div>

      <StepFooter onBack={onBack} onNext={onNext} nextLabel="Next: Stay →" isSaving={isSaving} />
    </div>
  );
}

// ─── Step 4: Stay / Accommodation ──────────────────────────────────────────────

function StayStep({
  data, onChange, onBack, onNext, isSaving,
}: {
  data: StayForm;
  onChange: (updates: Partial<StayForm>) => void;
  onBack: () => void;
  onNext: () => void;
  isSaving?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <StepHeader Icon={Home} title="Accommodation & Stay Preference" subtitle="Where & how the student plans to stay during the course" step={4} />

      <div className="divide-y divide-border">
        <Section title="Stay Preference">
          <FullRow>
            <CardSelect options={STAY_PREFERENCE_OPTIONS} value={data.stayPreference} onChange={(v) => onChange({ stayPreference: v })} />
          </FullRow>
        </Section>

        <Section title="Budget & Sharing">
          <Field label="Monthly Accommodation Budget">
            <MultiSelect options={MONTHLY_ACCOMMODATION_BUDGET_OPTIONS} selected={data.monthlyAccommodationBudget} onChange={(v) => onChange({ monthlyAccommodationBudget: v })} placeholder="— Select Range —" />
          </Field>
          <FullRow>
            <Field label="Room Sharing Preference">
              <PillGroup options={ROOM_SHARING_OPTIONS} value={data.roomSharing} onChange={(v) => onChange({ roomSharing: v })} />
            </Field>
          </FullRow>
        </Section>

        <Section title="Food & Amenities">
          <FullRow>
            <Field label="Meals / Food Preference">
              <PillGroup options={MEALS_OPTIONS} value={data.mealsPreference} onChange={(v) => onChange({ mealsPreference: v })} />
            </Field>
          </FullRow>
          <FullRow>
            <Field label="Key Amenity Requirements">
              <MultiPillGroup options={KEY_AMENITY_OPTIONS} value={data.keyAmenities} onChange={(v) => onChange({ keyAmenities: v })} />
            </Field>
          </FullRow>
        </Section>

        <Section title="Location & Hostel">
          <FullRow>
            <Field label="Distance Willingness from College">
              <PillGroup options={DISTANCE_OPTIONS} value={data.distanceWillingness} onChange={(v) => onChange({ distanceWillingness: v })} />
            </Field>
          </FullRow>
          <FullRow>
            <Field label="Gender Hostel Requirement">
              <PillGroup options={GENDER_HOSTEL_OPTIONS} value={data.genderHostelRequirement} onChange={(v) => onChange({ genderHostelRequirement: v })} />
            </Field>
          </FullRow>
        </Section>
      </div>

      <StepFooter onBack={onBack} onNext={onNext} nextLabel="Next: Academics →" isSaving={isSaving} />
    </div>
  );
}

// ─── Step 5: Academics ──────────────────────────────────────────────────────────

function AcademicsStep({
  data, onChange, onBack, onNext, isSaving,
}: {
  data: AcademicsForm;
  onChange: (updates: Partial<AcademicsForm>) => void;
  onBack: () => void;
  onNext: () => void;
  isSaving?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <StepHeader Icon={BarChart3} title="Academic Profile" subtitle="Board, qualifying scores & learning background" step={5} />

      <div className="divide-y divide-border">
        <Section title="Board / Qualifying Exam">
          <Field label="Class 10 Percentage / CGPA">
            <input className={INPUT_CLASS} placeholder="e.g. 85% or 8.5 CGPA" value={data.class10Percentage}
              onChange={(e) => onChange({ class10Percentage: e.target.value })} />
          </Field>
          <Field label="Class 12 Percentage / CGPA">
            <input className={INPUT_CLASS} placeholder="e.g. 78% or 7.8 CGPA" value={data.class12Percentage}
              onChange={(e) => onChange({ class12Percentage: e.target.value })} />
          </Field>
          <Field label="Board">
            <MultiSelect options={BOARD_OPTIONS} selected={data.board} onChange={(v) => onChange({ board: v })} placeholder="— Select —" />
          </Field>
        </Section>

        <Section title="Background">
          <FullRow>
            <Field label="Gap Year / Break Reason">
              <PillGroup options={GAP_YEAR_OPTIONS} value={data.gapYearReason} onChange={(v) => onChange({ gapYearReason: v })} />
            </Field>
          </FullRow>
          <FullRow>
            <Field label="Medium of Instruction Preference">
              <PillGroup options={MEDIUM_OF_INSTRUCTION_OPTIONS} value={data.mediumOfInstruction} onChange={(v) => onChange({ mediumOfInstruction: v })} />
            </Field>
          </FullRow>
        </Section>
      </div>

      <StepFooter onBack={onBack} onNext={onNext} nextLabel="Next: Summary →" isSaving={isSaving} />
    </div>
  );
}

// ─── Step 6: Summary ────────────────────────────────────────────────────────────

function SummaryRow({ label, value }: { label: string; value?: string | string[] | null }) {
  const display = Array.isArray(value)
    ? (value.length ? value.join(', ') : '—')
    : (value && value.trim() ? value : '—');
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">{label}</p>
      <p className="text-sm font-semibold text-foreground break-words">{display}</p>
    </div>
  );
}

function SummarySection({ title, onEdit, children }: { title: string; onEdit: () => void; children: React.ReactNode }) {
  return (
    <div className="px-4 sm:px-5 py-4">
      <div className="mb-3.5 flex items-center gap-3">
        <p className="shrink-0 text-[11px] font-bold uppercase tracking-widest text-primary/80">{title}</p>
        <span className="h-px flex-1 bg-border/70" />
        <button onClick={onEdit} className="shrink-0 rounded-md border border-input px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/5">
          Edit
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-5 gap-y-4">
        {children}
      </div>
    </div>
  );
}

function SummaryStep({
  basicInfo, courses, budget, stay, academics, onBack, onEditStep,
}: {
  basicInfo: BasicInfoForm;
  courses: CoursesCollegesForm;
  budget: BudgetForm;
  stay: StayForm;
  academics: AcademicsForm;
  onBack: () => void;
  onEditStep: (step: number) => void;
}) {
  const { data: coursesList = [] } = useQuery<StaticOption[]>({
    queryKey: ['static-courses'],
    queryFn: () => fetch('/api/courses').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });
  const { data: collegesList = [] } = useQuery<StaticOption[]>({
    queryKey: ['static-colleges'],
    queryFn: () => fetch('/api/colleges').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });

  const courseNames = useMemo(() => idsToNames(courses.courseInterested, coursesList), [courses.courseInterested, coursesList]);
  const collegeNames = useMemo(() => idsToNames(courses.collegeInterested, collegesList), [courses.collegeInterested, collegesList]);

  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <StepHeader Icon={FileText} title="Summary & Review" subtitle="Everything captured for this lead, across all steps" step={6} />

      <div className="divide-y divide-border">
        <SummarySection title="Basic Info" onEdit={() => onEditStep(1)}>
          <SummaryRow label="Name" value={basicInfo.fullName} />
          <SummaryRow label="Phone" value={basicInfo.mobile} />
          <SummaryRow label="Email" value={basicInfo.email} />
          <SummaryRow label="Parent / Guardian Name" value={basicInfo.parentName} />
          <SummaryRow label="Parent Mobile" value={basicInfo.parentMobile} />
          <SummaryRow label="Gender" value={basicInfo.gender} />
          <SummaryRow label="Category" value={basicInfo.category} />
          <SummaryRow label="City" value={basicInfo.city} />
          <SummaryRow label="State" value={basicInfo.state} />
          <SummaryRow label="Current Class / Year" value={basicInfo.classYear} />
          <SummaryRow label="Correct Phone 1" value={basicInfo.correctPhone1} />
          <SummaryRow label="Correct Phone 2" value={basicInfo.correctPhone2} />
          <SummaryRow label="Correct Email 1" value={basicInfo.correctEmail1} />
          <SummaryRow label="Correct Email 2" value={basicInfo.correctEmail2} />
          <SummaryRow label="Correct City" value={basicInfo.correctCity} />
          <SummaryRow label="Correct State" value={basicInfo.correctState} />
        </SummarySection>

        <SummarySection title="Preferences" onEdit={() => onEditStep(2)}>
          <SummaryRow label="Course(s) Interested In" value={courseNames} />
          <SummaryRow label="Preferred Course Type" value={courses.courseType} />
          <SummaryRow label="Specialisation / Branch Interest" value={courses.specialisation} />
          <SummaryRow label="College(s) Interested In" value={collegeNames} />
          <SummaryRow label="Preferred College Type" value={courses.collegeType} />
          <SummaryRow label="City Preference" value={courses.cityPreference} />
          <SummaryRow label="State Preference" value={courses.statePreference} />
          <SummaryRow label="Entrance Exams" value={courses.entranceExam} />
        </SummarySection>

        <SummarySection title="Budget & Finance" onEdit={() => onEditStep(3)}>
          <SummaryRow label="Total Course Budget" value={budget.totalCourseBudget} />
          <SummaryRow label="Scholarship Awareness" value={budget.scholarshipAwareness} />
          <SummaryRow label="Loan Requirement" value={budget.loanRequirement} />
          <SummaryRow label="Loan Amount Required" value={budget.loanAmount} />
          <SummaryRow label="Payment Mode Preference" value={budget.paymentModePreference} />
        </SummarySection>

        <SummarySection title="Accommodation" onEdit={() => onEditStep(4)}>
          <SummaryRow label="Stay Preference" value={stay.stayPreference} />
          <SummaryRow label="Monthly Accommodation Budget" value={stay.monthlyAccommodationBudget} />
          <SummaryRow label="Room Sharing Preference" value={stay.roomSharing} />
          <SummaryRow label="Meals / Food Preference" value={stay.mealsPreference} />
          <SummaryRow label="Key Amenity Requirements" value={stay.keyAmenities} />
          <SummaryRow label="Distance Willingness" value={stay.distanceWillingness} />
          <SummaryRow label="Gender Hostel Requirement" value={stay.genderHostelRequirement} />
        </SummarySection>

        <SummarySection title="Academics" onEdit={() => onEditStep(5)}>
          <SummaryRow label="Class 10 Percentage / CGPA" value={academics.class10Percentage} />
          <SummaryRow label="Class 12 Percentage / CGPA" value={academics.class12Percentage} />
          <SummaryRow label="Board" value={academics.board} />
          <SummaryRow label="Gap Year / Break Reason" value={academics.gapYearReason} />
          <SummaryRow label="Medium of Instruction Preference" value={academics.mediumOfInstruction} />
        </SummarySection>
      </div>

      <StepFooter onBack={onBack} />
    </div>
  );
}

// ─── Steps 2-7: placeholder (fields to be defined) ────────────────────────────

function PlaceholderStep({
  step, onBack, onNext, isLast,
}: {
  step: typeof STEPS[number];
  onBack: () => void;
  onNext: () => void;
  isLast: boolean;
}) {
  const { Icon, label } = step;
  return (
    <div className="rounded-xl border border-border bg-background shadow-sm">
      <StepHeader Icon={Icon} title={label} subtitle="Fields for this section will be added soon" />

      <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
        <Icon className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">Coming soon</p>
      </div>

      <StepFooter onBack={onBack} onNext={isLast ? undefined : onNext} nextLabel="Next →" />
    </div>
  );
}
