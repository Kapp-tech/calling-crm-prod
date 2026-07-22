'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useSession } from 'next-auth/react';
import { usePermissions } from '@/lib/usePermissions';
import { Search, SlidersHorizontal, X, ChevronDown, Check, Download, Loader2, ListFilter } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { LeadDetailDrawer } from '@/components/leads/lead-detail-drawer';
import { PaginationBar } from '@/components/shared/pagination-bar';
import { MultiSelectFilter, type MultiSelectOption } from '@/components/shared/multi-select-filter';
import { cn } from '@/lib/utils';
import { computeProfilingScore, profilingScoreTone } from '@/lib/lead-profiling';
import { feedbackCategoryTone } from '@/lib/feedback-category-colors';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string; name: string; email: string; phone: string;
  city?: string | null; state?: string | null; course?: string | null;
  college?: string | null; kappCollegeId?: string | null; campaign?: string | null;
  leadType?: string | null; leadOrigin?: string | null; leadZone?: string | null;
  primaryApplicationConfirm?: string | null; primaryAdmissionConfirm?: string | null;
  leadConfirmation?: string | null; leadStage?: string | null;
  leadVerification?: string | null; dataCallingType?: string | null;
  dealType?: string | null;
  uploadedAt?: string | null;
  status: string; createdAt: string; updatedAt: string;
  assignedTo?: { id: string; name: string } | null;
  feedbacks: { followUpNumber: number; feedbackOption?: { label: string } | null }[];
  _count: { feedbacks: number };
  classYear?: string | null;
  category?: string | null;
  parentName?: string | null;
  parentMobile?: string | null;
  gender?: string | null;
  profile?: {
    preferredCourseIds?: unknown; preferredCollegeIds?: unknown;
    preferredCityNames?: unknown; preferredStateNames?: unknown;
    courseType?: string | null; collegeType?: string | null; specialisation?: string | null;
    entranceExam?: unknown; budget?: string | null; scholarshipAwareness?: string | null;
    loanRequirement?: string | null; loanAmount?: string | null; paymentModePreference?: string | null;
    stayPreference?: string | null; monthlyAccommodationBudget?: string | null; roomSharing?: string | null;
    mealsPreference?: string | null; keyAmenities?: unknown; distanceWillingness?: string | null;
    genderHostelRequirement?: string | null; class10Percentage?: string | null; class12Percentage?: string | null;
    board?: string | null; gapYearReason?: string | null; mediumOfInstruction?: string | null;
  } | null;
}

interface FilterOptions {
  campaigns: string[]; leadTypes: string[]; leadOrigins: string[];
  leadZones: string[]; cities: string[]; states: string[];
  colleges: string[]; courses: string[];
  leadConfirmations: string[]; leadVerifications: string[]; dataCallingTypes: string[];
  primaryAppConfirms: string[]; primaryAdmConfirms: string[]; leadStages: string[];
  dealTypes: string[];
}

// ─── Advanced filter definitions ─────────────────────────────────────────────

interface FilterDef { key: string; label: string; }

const FILTER_GROUPS: { group: string; filters: FilterDef[] }[] = [
  {
    group: 'Lead Source',
    filters: [
      { key: 'campaign',   label: 'Lead Code'    },
      { key: 'leadType',   label: 'Lead Type'   },
      { key: 'leadOrigin', label: 'Lead Origin' },
      { key: 'zone',       label: 'Zone'        },
    ],
  },
  {
    group: 'Assignment',
    filters: [
      { key: 'workType', label: 'Type (WFH/WFO)' },
      { key: 'tl',       label: 'Counselling TL'    },
      { key: 'agent',    label: 'Counselling Agent' },
    ],
  },
  {
    group: 'Dates',
    filters: [
      { key: 'createdAt', label: 'Created Date Range' },
      { key: 'updatedAt', label: 'Updated Date Range' },
    ],
  },
  {
    group: 'Lead Status',
    filters: [
      { key: 'primaryAppConfirm', label: 'Primary App. Confirm'  },
      { key: 'primaryAdmConfirm', label: 'Primary Adm. Confirm'  },
      { key: 'leadConfirmation',  label: 'Lead Confirmation'     },
      { key: 'leadStage',         label: 'Lead Stage'            },
      { key: 'leadVerification',  label: 'Lead Verification'     },
      { key: 'dataCallingType',   label: 'Data Calling Type'     },
      { key: 'dealType',          label: 'Deal Type'             },
    ],
  },
];

interface FeedbackOption {
  id: string; label: string; categoryId?: string | null;
  category?: { id: string; name: string; color: string } | null;
}
interface FeedbackCategory { id: string; name: string; color: string; }

// 'all' | 'fresh' are special sentinels; anything else is a feedbackOption.id[]
type FeedbackMode = 'all' | 'fresh';
type ActiveTab = FeedbackMode | string; // kept for handleTabChange compat

const ZONE_DOT: Record<string, string> = {
  North: 'bg-blue-500', South: 'bg-green-500', East: 'bg-orange-500',
  West: 'bg-purple-500', Central: 'bg-yellow-500',
};

function displayLeadId(id: string) {
  return id;
}

// ─── Skeleton rows ────────────────────────────────────────────────────────────

const SKELETON_WIDTHS = [4, 8, 20, 28, 40, 24, 16, 16, 20, 32, 16, 20, 20, 16, 24, 16, 20, 14, 24, 20, 20, 24, 24, 20, 20, 20, 28];

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 10 }).map((_, i) => (
        <tr key={i} className="border-b border-border/40 animate-pulse">
          {SKELETON_WIDTHS.map((w, j) => (
            <td key={j} className="px-3 py-2.5">
              <div className={`h-3 w-${w} rounded bg-muted`} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AllLeadsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role;

  // Basic filters — all multi-select
  const [search,   setSearch]   = useState('');
  const [cities,   setCities]   = useState<string[]>([]);
  const [states,   setStates]   = useState<string[]>([]);
  const [courses,  setCourses]  = useState<string[]>([]);
  const [colleges, setColleges] = useState<string[]>([]);
  const [dateFrom,        setDateFrom]        = useState('');
  const [dateTo,          setDateTo]          = useState('');
  const [updatedDateFrom, setUpdatedDateFrom] = useState('');
  const [updatedDateTo,   setUpdatedDateTo]   = useState('');

  // Advanced filters — all multi-select
  const [campaigns,    setCampaigns]    = useState<string[]>([]);
  const [leadTypes,    setLeadTypes]    = useState<string[]>([]);
  const [leadOrigins,  setLeadOrigins]  = useState<string[]>([]);
  const [zones,        setZones]        = useState<string[]>([]);
  const [workType,     setWorkType]     = useState<string>('');
  const [tlIds,        setTlIds]        = useState<string[]>([]);
  const [agentIds,     setAgentIds]     = useState<string[]>([]);

  // New advanced filter states
  const [primaryAppConfirms,   setPrimaryAppConfirms]   = useState<string[]>([]);
  const [primaryAdmConfirms,   setPrimaryAdmConfirms]   = useState<string[]>([]);
  const [leadConfirmations,    setLeadConfirmations]    = useState<string[]>([]);
  const [leadStages,           setLeadStages]           = useState<string[]>([]);
  const [leadVerifications,    setLeadVerifications]    = useState<string[]>([]);
  const [dataCallingTypes,     setDataCallingTypes]     = useState<string[]>([]);
  const [dealTypes,            setDealTypes]            = useState<string[]>([]);

  // Dialog state — which filter keys are "active" (shown below basic filters)
  const [activeFilters,     setActiveFilters]     = useState<string[]>([]);
  const [dialogFilters,     setDialogFilters]     = useState<string[]>([]);
  const [filterDialogOpen,  setFilterDialogOpen]  = useState(false);

  // UI state
  const [feedbackMode,   setFeedbackMode]   = useState<'all' | 'fresh' | 'options'>('all');
  const [selectedOptIds, setSelectedOptIds] = useState<string[]>([]);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [page,           setPage]           = useState(1);
  const [limit,          setLimit]          = useState(25);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedIds,    setSelectedIds]    = useState<string[]>([]);

  // Count of active filters that have a value set
  const advancedCount = [
    campaigns.length > 0, leadTypes.length > 0, leadOrigins.length > 0,
    zones.length > 0, !!workType, tlIds.length > 0, agentIds.length > 0,
    !!(updatedDateFrom || updatedDateTo), !!(dateFrom || dateTo),
    primaryAppConfirms.length > 0, primaryAdmConfirms.length > 0,
    leadConfirmations.length > 0, leadStages.length > 0,
    leadVerifications.length > 0, dataCallingTypes.length > 0,
    dealTypes.length > 0,
  ].filter(Boolean).length;

  function openFilterDialog() {
    setDialogFilters(activeFilters);
    setFilterDialogOpen(true);
  }

  function applyFilterDialog() {
    // Clear values for any filter that was removed
    const removed = activeFilters.filter((k) => !dialogFilters.includes(k));
    removed.forEach(clearFilterValue);
    setActiveFilters(dialogFilters);
    setFilterDialogOpen(false);
  }

  function clearFilterValue(key: string) {
    switch (key) {
      case 'campaign':          setCampaigns([]);            break;
      case 'leadType':          setLeadTypes([]);            break;
      case 'leadOrigin':        setLeadOrigins([]);          break;
      case 'zone':              setZones([]);                break;
      case 'workType':          setWorkType('');             break;
      case 'tl':                setTlIds([]);                break;
      case 'agent':             setAgentIds([]);             break;
      case 'createdAt':         setDateFrom(''); setDateTo(''); break;
      case 'updatedAt':         setUpdatedDateFrom(''); setUpdatedDateTo(''); break;
      case 'primaryAppConfirm': setPrimaryAppConfirms([]);   break;
      case 'primaryAdmConfirm': setPrimaryAdmConfirms([]);   break;
      case 'leadConfirmation':  setLeadConfirmations([]);    break;
      case 'leadStage':         setLeadStages([]);           break;
      case 'leadVerification':  setLeadVerifications([]);    break;
      case 'dataCallingType':   setDataCallingTypes([]);     break;
      case 'dealType':          setDealTypes([]);            break;
    }
  }

  function toggleDialogFilter(key: string) {
    setDialogFilters((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  // ── Feedback options (for dynamic tabs) ────────────────────────────────────

  const { data: feedbackOptions = [] } = useQuery<FeedbackOption[]>({
    queryKey: ['feedback-options'],
    queryFn: () => fetch('/api/feedback-options').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });

  const { data: feedbackCategories = [] } = useQuery<FeedbackCategory[]>({
    queryKey: ['feedback-categories'],
    queryFn: () => fetch('/api/feedback-categories').then((r) => r.json()).then((d) => Array.isArray(d) ? d : []),
    staleTime: Infinity,
  });

  // Base filter params shared by the main leads query and the category-count
  // badges — keeping this in one place is what guarantees the badge numbers
  // can never drift out of sync with what clicking the pill actually shows.
  function buildBaseParams() {
    // All Leads only shows leads that have been assigned to an agent —
    // unassigned leads live in the TL's Assign Leads queue instead.
    const p = new URLSearchParams({ status: 'APPROVED', assignmentStatus: 'assigned' });
    if (search)           p.set('search', search);
    if (cities.length)    p.set('city', cities.join(','));
    if (states.length)    p.set('state', states.join(','));
    if (courses.length)   p.set('course', courses.join(','));
    if (colleges.length)  p.set('college', colleges.join(','));
    if (dateFrom)         p.set('dateFrom', dateFrom);
    if (dateTo)           p.set('dateTo', dateTo);
    if (updatedDateFrom)  p.set('updatedFrom', updatedDateFrom);
    if (updatedDateTo)    p.set('updatedTo', updatedDateTo);
    if (campaigns.length)         p.set('campaign',          campaigns.join(','));
    if (leadTypes.length)         p.set('leadType',          leadTypes.join(','));
    if (leadOrigins.length)       p.set('leadOrigin',        leadOrigins.join(','));
    if (zones.length)             p.set('zone',              zones.join(','));
    if (tlIds.length)             p.set('tlId',              tlIds.join(','));
    if (agentIds.length)          p.set('assignedToId',      agentIds.join(','));
    if (primaryAppConfirms.length)  p.set('primaryAppConfirm',  primaryAppConfirms.join(','));
    if (primaryAdmConfirms.length)  p.set('primaryAdmConfirm',  primaryAdmConfirms.join(','));
    if (leadConfirmations.length)   p.set('leadConfirmation',    leadConfirmations.join(','));
    if (leadStages.length)          p.set('leadStage',           leadStages.join(','));
    if (leadVerifications.length)   p.set('leadVerification',    leadVerifications.join(','));
    if (dataCallingTypes.length)    p.set('dataCallingType',     dataCallingTypes.join(','));
    if (dealTypes.length)           p.set('dealType',            dealTypes.join(','));
    return p;
  }

  const baseParamsDeps = [
    search, cities, states, courses, colleges, dateFrom, dateTo,
    updatedDateFrom, updatedDateTo,
    campaigns, leadTypes, leadOrigins, zones, tlIds, agentIds,
    primaryAppConfirms, primaryAdmConfirms, leadConfirmations,
    leadStages, leadVerifications, dataCallingTypes, dealTypes,
  ];

  const { data: categoryCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ['feedback-category-counts', ...baseParamsDeps],
    queryFn: () => fetch(`/api/leads/feedback-category-counts?${buildBaseParams()}`).then((r) => r.json()).then((d) => (d && typeof d === 'object' ? d : {})),
    enabled: !!session?.user?.id,
  });

  // ── Main query ─────────────────────────────────────────────────────────────

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'all-leads', ...baseParamsDeps,
      feedbackMode, selectedOptIds, selectedCategoryIds, page, limit,
    ],
    queryFn: () => {
      const p = buildBaseParams();
      p.set('page', String(page));
      p.set('limit', String(limit));
      if (feedbackMode === 'fresh') {
        p.set('feedbackTab', 'fresh');
      } else {
        if (selectedOptIds.length > 0)      p.set('feedbackOptionIds',   selectedOptIds.join(','));
        if (selectedCategoryIds.length > 0) p.set('feedbackCategoryIds', selectedCategoryIds.join(','));
      }
      return fetch(`/api/leads?${p}`).then((r) => r.json());
    },
    enabled: !!session?.user?.id,
    placeholderData: (prev) => prev,
  });

  // ── Filter options (DB-sourced distinct values) ────────────────────────────

  const { data: filterOpts, isLoading: optsLoading } = useQuery<FilterOptions>({
    queryKey: ['lead-filter-options'],
    queryFn: () => fetch('/api/leads/filter-options').then((r) => r.json()),
    staleTime: 2 * 60 * 1000,
    enabled: !!session?.user?.id,
  });

  const str2opt  = (arr: string[] = []): MultiSelectOption[] => arr.map((v) => ({ value: v, label: v }));

  const cityOptions             = useMemo(() => str2opt(filterOpts?.cities),            [filterOpts]);
  const stateOptions            = useMemo(() => str2opt(filterOpts?.states),            [filterOpts]);
  const courseOptions           = useMemo(() => str2opt(filterOpts?.courses),           [filterOpts]);
  const collegeOptions          = useMemo(() => str2opt(filterOpts?.colleges),          [filterOpts]);
  const campaignOptions         = useMemo(() => str2opt(filterOpts?.campaigns),         [filterOpts]);
  const leadTypeOptions         = useMemo(() => str2opt(filterOpts?.leadTypes),         [filterOpts]);
  const leadOriginOptions       = useMemo(() => str2opt(filterOpts?.leadOrigins),       [filterOpts]);
  const zoneOptions             = useMemo(() => str2opt(filterOpts?.leadZones?.length ? filterOpts.leadZones : ['North', 'South', 'East', 'West', 'Central']), [filterOpts]);
  const leadConfirmationOptions = useMemo(() => str2opt(filterOpts?.leadConfirmations), [filterOpts]);
  const leadVerificationOptions = useMemo(() => str2opt(filterOpts?.leadVerifications), [filterOpts]);
  const dataCallingTypeOptions  = useMemo(() => str2opt(filterOpts?.dataCallingTypes),  [filterOpts]);
  const primaryAppConfirmOpts   = useMemo(() => str2opt(filterOpts?.primaryAppConfirms ?? ['Yes', 'No']), [filterOpts]);
  const primaryAdmConfirmOpts   = useMemo(() => str2opt(filterOpts?.primaryAdmConfirms ?? ['Yes', 'No']), [filterOpts]);
  const leadStageOptions        = useMemo(() => str2opt(filterOpts?.leadStages),        [filterOpts]);
  const dealTypeOptions         = useMemo(() => str2opt(filterOpts?.dealTypes),         [filterOpts]);

  // ── TLs / Agents ───────────────────────────────────────────────────────────

  const showTlFilter    = role === 'SUPER_ADMIN' || role === 'REPORTS';
  const showAgentFilter = role === 'SUPER_ADMIN' || role === 'REPORTS' || role === 'COUNSELLING_TL';

  const { data: tlsRaw = [] } = useQuery<{ id: string; name: string; workType: string }[]>({
    queryKey: ['tls-list'],
    queryFn: () => fetch('/api/users?role=COUNSELLING_TL').then(async (r) => { const d = await r.json(); return Array.isArray(d) ? d : []; }),
    staleTime: 5 * 60 * 1000,
    enabled: showTlFilter && !!session?.user?.id,
  });

  const { data: agentsRaw = [] } = useQuery<{ id: string; name: string; workType: string }[]>({
    queryKey: ['agents-list'],
    queryFn: () => fetch('/api/users?role=COUNSELLING_AGENT').then(async (r) => { const d = await r.json(); return Array.isArray(d) ? d : []; }),
    staleTime: 5 * 60 * 1000,
    enabled: showAgentFilter && !!session?.user?.id,
  });

  const tlOptions    = useMemo(() => tlsRaw.filter((u) => !workType || u.workType === workType).map((u) => ({ value: u.id, label: u.name })), [tlsRaw, workType]);
  const agentOptions = useMemo(() => agentsRaw.filter((u) => !workType || u.workType === workType).map((u) => ({ value: u.id, label: u.name })), [agentsRaw, workType]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const leads: Lead[]      = data?.leads ?? [];
  const total: number      = data?.total ?? 0;
  const totalPages: number = data?.totalPages ?? 1;

  const { can } = usePermissions();
  const canSubmitFeedback = can('SUBMIT_FEEDBACK');
  const canDownload       = can('DOWNLOAD_DATA');

  const [isDownloading, setIsDownloading] = useState(false);

  function buildExportUrl() {
    const p = buildBaseParams();
    if (feedbackMode === 'fresh') {
      p.set('feedbackTab', 'fresh');
    } else {
      if (selectedOptIds.length > 0)      p.set('feedbackOptionIds',   selectedOptIds.join(','));
      if (selectedCategoryIds.length > 0) p.set('feedbackCategoryIds', selectedCategoryIds.join(','));
    }
    return `/api/leads/export?${p}`;
  }

  async function handleDownload() {
    setIsDownloading(true);
    try {
      const res = await fetch(buildExportUrl());
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // silently fail — user will see nothing downloaded
    } finally {
      setIsDownloading(false);
    }
  }

  const hasBasicFilter = !!(search || cities.length || states.length || courses.length || colleges.length);
  const hasAnyFilter   = hasBasicFilter || advancedCount > 0;

  function clearAll() {
    setSearch(''); setCities([]); setStates([]); setCourses([]); setColleges([]);
    setDateFrom(''); setDateTo('');
    setUpdatedDateFrom(''); setUpdatedDateTo('');
    setCampaigns([]); setLeadTypes([]); setLeadOrigins([]); setZones([]);
    setTlIds([]); setAgentIds([]);
    setPrimaryAppConfirms([]); setPrimaryAdmConfirms([]);
    setLeadConfirmations([]); setLeadStages([]);
    setLeadVerifications([]); setDataCallingTypes([]);
    setDealTypes([]);
    setActiveFilters([]);
    setFeedbackMode('all'); setSelectedOptIds([]); setSelectedCategoryIds([]);
    setPage(1);
  }

  const allIds      = leads.map((l) => l.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.includes(id));
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]);
  const toggleAll = () => setSelectedIds(allSelected ? [] : allIds);

  function toggleFeedbackOption(id: string) {
    setSelectedOptIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      setFeedbackMode(next.length > 0 || selectedCategoryIds.length > 0 ? 'options' : 'all');
      return next;
    });
    setPage(1); setSelectedIds([]);
  }

  function toggleFeedbackCategory(id: string) {
    setSelectedCategoryIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      setFeedbackMode(next.length > 0 || selectedOptIds.length > 0 ? 'options' : 'all');
      return next;
    });
    setPage(1); setSelectedIds([]);
  }

  function selectFeedbackMode(mode: 'all' | 'fresh') {
    setFeedbackMode(mode); setSelectedOptIds([]); setSelectedCategoryIds([]); setPage(1); setSelectedIds([]);
  }

  // kept for compat (export URL etc)
  const handleTabChange = (tab: ActiveTab) => {
    if (tab === 'all' || tab === 'fresh') selectFeedbackMode(tab);
    else toggleFeedbackOption(tab);
  };;

  const filterChange = (fn: () => void) => { fn(); setPage(1); };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">

      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">All Leads</h1>
          <p className="text-sm text-muted-foreground mt-0.5 min-h-[1.25rem]">
            {isLoading
              ? <span className="inline-block h-3 w-20 rounded bg-muted animate-pulse" />
              : `${total} leads found`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isFetching && !isLoading && (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a8 8 0 100 8v-4a8 8 0 01-8-8z" />
              </svg>
              Updating…
            </span>
          )}
          {canDownload && (
            <button
              onClick={handleDownload}
              disabled={isDownloading || isLoading || total === 0}
              className={cn(
                'h-8 px-3 flex items-center gap-1.5 text-xs rounded-md border transition-colors',
                isDownloading
                  ? 'border-primary/40 bg-primary/5 text-primary cursor-wait'
                  : 'border-input text-muted-foreground hover:text-foreground hover:border-primary/50 disabled:opacity-40 disabled:cursor-not-allowed',
              )}
              title={`Download all ${total} matching leads as CSV`}
            >
              {isDownloading
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <Download className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">
                {isDownloading ? 'Preparing…' : `Download${hasAnyFilter ? ' Filtered' : ''} CSV`}
              </span>
              <span className="sm:hidden">
                {isDownloading ? '…' : 'CSV'}
              </span>
              {!isDownloading && total > 0 && (
                <span className="ml-0.5 rounded bg-muted px-1 py-0.5 text-[10px] font-medium">{total}</span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Feedback filter capsules — All/Fresh are mutually exclusive; categories and options are multi-selectable */}
      <div className="flex gap-1.5 flex-nowrap sm:flex-wrap mb-4 overflow-x-auto pb-1 -mx-1 px-1 [&>button]:shrink-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:[scrollbar-width:auto]">
        {(['all', 'fresh'] as const).map((mode) => (
          <button
            key={mode}
            onClick={() => selectFeedbackMode(mode)}
            className={cn(
              'px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
              feedbackMode === mode && selectedOptIds.length === 0 && selectedCategoryIds.length === 0
                ? 'bg-primary/20 border-primary/50 text-primary'
                : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground',
            )}
          >
            {mode === 'all' ? 'All' : 'Fresh'}
          </button>
        ))}

        {/* Category capsules — self-defined groupings like Hot / Warm / Cold */}
        {feedbackCategories.length > 0 && (
          <span className="mx-0.5 hidden sm:block w-px bg-border/60 self-stretch" />
        )}
        {feedbackCategories.map((cat) => {
          const active = selectedCategoryIds.includes(cat.id);
          const tone = feedbackCategoryTone(cat.color);
          const count = categoryCounts[cat.id] ?? 0;
          return (
            <button
              key={cat.id}
              onClick={() => toggleFeedbackCategory(cat.id)}
              aria-pressed={active}
              style={active ? tone.chipActiveStyle : undefined}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all duration-150',
                !active && 'border-border/60 bg-background text-muted-foreground hover:border-foreground/40 hover:text-foreground',
              )}
            >
              {active
                ? <Check className="h-3 w-3 shrink-0" strokeWidth={3} />
                : <span className="h-1.5 w-1.5 rounded-full shrink-0" style={tone.dotStyle} />}
              {cat.name}
              <span
                className={cn(
                  'inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-1 text-[10px] font-bold',
                  active && 'bg-white/25 text-white',
                )}
                style={active ? undefined : tone.badgeStyle}
              >
                {count}
              </span>
            </button>
          );
        })}

        {feedbackOptions.length > 0 && (
          <span className="mx-0.5 hidden sm:block w-px bg-border/60 self-stretch" />
        )}
        {/* Dynamic feedback option capsules — multi-selectable */}
        {feedbackOptions.map((opt) => {
          const active = selectedOptIds.includes(opt.id);
          return (
            <button
              key={opt.id}
              onClick={() => toggleFeedbackOption(opt.id)}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors',
                active
                  ? 'bg-primary/20 border-primary/50 text-primary'
                  : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* ── Basic filter row ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2 mb-2 items-center">

        {/* Search — stays text */}
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" placeholder="Search by Lead ID, name, phone, email…" value={search}
            onChange={(e) => filterChange(() => setSearch(e.target.value))}
            className="h-8 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <MultiSelectFilter placeholder="All Cities"   options={cityOptions}    selected={cities}   onChange={(v) => filterChange(() => setCities(v))}   loading={optsLoading} />
        <MultiSelectFilter placeholder="All States"   options={stateOptions}   selected={states}   onChange={(v) => filterChange(() => setStates(v))}   loading={optsLoading} />
        <MultiSelectFilter placeholder="All Courses"  options={courseOptions}  selected={courses}  onChange={(v) => filterChange(() => setCourses(v))}  loading={optsLoading} />
        <MultiSelectFilter placeholder="All Colleges" options={collegeOptions} selected={colleges} onChange={(v) => filterChange(() => setColleges(v))} loading={optsLoading} />

        {/* Advanced filters dialog trigger */}
        <button onClick={openFilterDialog}
          className={cn(
            'h-8 px-3 flex items-center gap-1.5 text-xs rounded-md border transition-colors',
            advancedCount > 0
              ? 'border-primary/60 bg-primary/10 text-primary'
              : 'border-input text-muted-foreground hover:text-foreground'
          )}>
          <ListFilter className="h-3.5 w-3.5" />
          Advanced
          {advancedCount > 0 && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {advancedCount}
            </span>
          )}
        </button>

        {/* Clear all */}
        {hasAnyFilter && (
          <button onClick={clearAll}
            className="h-8 px-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-input rounded-md">
            <X className="h-3 w-3" /> Clear all
          </button>
        )}
      </div>

      {/* ── Active advanced filters ──────────────────────────────────────────── */}
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-3 mb-3 p-3 rounded-lg border border-border/60 bg-muted/10 items-end">
          {activeFilters.includes('campaign') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Code</span>
              <MultiSelectFilter placeholder="All Campaigns" options={campaignOptions} selected={campaigns} onChange={(v) => filterChange(() => setCampaigns(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('leadType') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Type</span>
              <MultiSelectFilter placeholder="All Types" options={leadTypeOptions} selected={leadTypes} onChange={(v) => filterChange(() => setLeadTypes(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('leadOrigin') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Origin</span>
              <MultiSelectFilter placeholder="All Origins" options={leadOriginOptions} selected={leadOrigins} onChange={(v) => filterChange(() => setLeadOrigins(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('zone') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Zone</span>
              <MultiSelectFilter placeholder="All Zones" options={zoneOptions} selected={zones} onChange={(v) => filterChange(() => setZones(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('workType') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Type</span>
              <select
                value={workType}
                onChange={(e) => filterChange(() => setWorkType(e.target.value))}
                className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[120px]"
              >
                <option value="">All Types</option>
                <option value="WFH">WFH</option>
                <option value="WFO">WFO</option>
              </select>
            </div>
          )}
          {activeFilters.includes('tl') && showTlFilter && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Counselling TL</span>
              <MultiSelectFilter placeholder="All TLs" options={tlOptions} selected={tlIds} onChange={(v) => filterChange(() => setTlIds(v))} />
            </div>
          )}
          {activeFilters.includes('agent') && showAgentFilter && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Counselling Agent</span>
              <MultiSelectFilter placeholder="All Agents" options={agentOptions} selected={agentIds} onChange={(v) => filterChange(() => setAgentIds(v))} />
            </div>
          )}
          {activeFilters.includes('createdAt') && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Created From</span>
                <input type="date" value={dateFrom} onChange={(e) => filterChange(() => setDateFrom(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[140px]" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Created To</span>
                <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => filterChange(() => setDateTo(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[140px]" />
              </div>
            </>
          )}
          {activeFilters.includes('updatedAt') && (
            <>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Updated From</span>
                <input type="date" value={updatedDateFrom} onChange={(e) => filterChange(() => setUpdatedDateFrom(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[140px]" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Updated To</span>
                <input type="date" value={updatedDateTo} min={updatedDateFrom || undefined} onChange={(e) => filterChange(() => setUpdatedDateTo(e.target.value))}
                  className="h-8 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-w-[140px]" />
              </div>
            </>
          )}
          {activeFilters.includes('primaryAppConfirm') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Primary App. Confirm</span>
              <MultiSelectFilter placeholder="Any" options={primaryAppConfirmOpts} selected={primaryAppConfirms} onChange={(v) => filterChange(() => setPrimaryAppConfirms(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('primaryAdmConfirm') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Primary Adm. Confirm</span>
              <MultiSelectFilter placeholder="Any" options={primaryAdmConfirmOpts} selected={primaryAdmConfirms} onChange={(v) => filterChange(() => setPrimaryAdmConfirms(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('leadConfirmation') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Confirmation</span>
              <MultiSelectFilter placeholder="Any" options={leadConfirmationOptions} selected={leadConfirmations} onChange={(v) => filterChange(() => setLeadConfirmations(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('leadStage') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Stage</span>
              <MultiSelectFilter placeholder="Any" options={leadStageOptions} selected={leadStages} onChange={(v) => filterChange(() => setLeadStages(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('leadVerification') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Lead Verification</span>
              <MultiSelectFilter placeholder="Any" options={leadVerificationOptions} selected={leadVerifications} onChange={(v) => filterChange(() => setLeadVerifications(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('dataCallingType') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Data Calling Type</span>
              <MultiSelectFilter placeholder="Any" options={dataCallingTypeOptions} selected={dataCallingTypes} onChange={(v) => filterChange(() => setDataCallingTypes(v))} loading={optsLoading} />
            </div>
          )}
          {activeFilters.includes('dealType') && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Deal Type</span>
              <MultiSelectFilter placeholder="Any" options={dealTypeOptions} selected={dealTypes} onChange={(v) => filterChange(() => setDealTypes(v))} loading={optsLoading} />
            </div>
          )}
        </div>
      )}

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <div className={cn('flex-1 overflow-auto rounded-lg border border-border/60 transition-opacity duration-150', isFetching && 'opacity-60')}>
        <table className="w-full text-sm border-collapse">
          <thead className="sticky top-0 z-20">
            <tr className="border-b border-border/60 bg-muted">
              {/* Sticky: checkbox — pinned on both axes, needs highest z */}
              <th className="sticky left-0 z-30 bg-muted w-10 px-3 py-2.5 text-left">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded border-border" />
              </th>
              {/* Sr No. — not sticky; scrolls away revealing Lead ID sticky at left-10 */}
              <th className="w-10 px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Sr No.
              </th>
              {/* Sticky: Lead ID — pinned on both axes, needs highest z */}
              <th className="sticky left-10 z-30 bg-muted border-r border-border/60 whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[112px]">
                Lead ID
              </th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[150px]">Name</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[190px]">Email</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[130px]">Phone</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[90px]">City</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[90px]">State</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[110px]">Course</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[160px]">College</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[130px]">KAPP College ID</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[140px]">Agent</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[160px]">Feedback</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[130px]">Profile %</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[130px]">Lead Code</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[120px]">Lead Type</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[120px]">Lead Origin</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[90px]">Zone</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[160px]">Primary App. Confirm</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[160px]">Primary Adm. Confirm</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[140px]">Lead Confirmation</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[120px]">Lead Stage</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[140px]">Lead Verification</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[140px]">Data Calling Type</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[120px]">Deal Type</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[130px]">Updated At</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[130px]">Created At</th>
              <th className="whitespace-nowrap px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-muted-foreground min-w-[130px]">Uploaded At</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? <SkeletonRows /> : (
              <AnimatePresence initial={false}>
                {leads.map((lead, rowIdx) => {
                  const isSelected      = selectedLeadId === lead.id;
                  const latestFeedback  = lead.feedbacks[0]?.feedbackOption?.label;
                  const zoneColor       = lead.leadZone ? ZONE_DOT[lead.leadZone] ?? 'bg-gray-400' : null;
                  const profilingPct    = computeProfilingScore(lead).percentage;
                  const profilingTone   = profilingScoreTone(profilingPct);

                  // Sticky cells MUST use fully opaque backgrounds — any alpha lets scrolled content bleed through
                  const stickyBg = isSelected
                    ? 'bg-blue-50 dark:bg-blue-950'
                    : 'bg-card group-hover:bg-muted';

                  const srNo = (page - 1) * limit + rowIdx + 1;

                  const fmtDate = (d: string) =>
                    new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) +
                    ', ' +
                    new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

                  return (
                    <motion.tr
                      key={lead.id}
                      layout="position"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, delay: Math.min(rowIdx, 15) * 0.015 }}
                      onClick={() => setSelectedLeadId(lead.id)}
                      className={cn(
                        'group border-b border-border/40 cursor-pointer transition-colors last:border-0',
                        isSelected ? 'bg-primary/10' : 'hover:bg-muted/20',
                      )}
                    >
                      {/* Sticky: checkbox */}
                      <td
                        className={cn('sticky left-0 z-10 px-3 py-2.5 transition-colors', stickyBg)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input type="checkbox" checked={selectedIds.includes(lead.id)} onChange={() => toggleSelect(lead.id)} className="rounded border-border" />
                      </td>

                      {/* Sr No. */}
                      <td className="px-3 py-2.5 text-xs text-muted-foreground tabular-nums whitespace-nowrap">{srNo}</td>

                      {/* Sticky: Lead ID */}
                      <td className={cn('sticky left-10 z-10 border-r border-border/60 px-3 py-2.5 font-mono text-xs text-muted-foreground whitespace-nowrap transition-colors', stickyBg)}>
                        {displayLeadId(lead.id)}
                      </td>

                      <td className="px-3 py-2.5 whitespace-nowrap font-semibold text-sm">{lead.name}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.email}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-[#e90000] font-medium text-sm">{lead.phone}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.city || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.state || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.course || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.college || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs font-mono text-muted-foreground">{lead.kappCollegeId || '—'}</td>

                      {/* Agent */}
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs">
                        {lead.assignedTo
                          ? <span className="font-medium text-foreground">{lead.assignedTo.name}</span>
                          : <span className="text-muted-foreground">Unassigned</span>}
                      </td>

                      {/* Feedback — moved here from bottom */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {latestFeedback
                          ? <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
                              {latestFeedback}
                            </span>
                          : <span className="inline-flex items-center rounded-full border border-border/50 bg-muted/40 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                              Fresh
                            </span>}
                      </td>

                      {/* Profile completeness */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted shrink-0">
                            <div
                              className={cn('h-full rounded-full transition-all duration-500 ease-premium', profilingTone.bar)}
                              style={{ width: `${profilingPct}%` }}
                            />
                          </div>
                          <span className={cn('text-[11px] font-bold tabular-nums', profilingTone.text)}>
                            {profilingPct}%
                          </span>
                        </div>
                      </td>

                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.campaign || '—'}</td>

                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.leadType || '—'}</td>

                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.leadOrigin || '—'}</td>

                      {/* Zone dot */}
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {lead.leadZone && zoneColor
                          ? <span className="inline-flex items-center gap-1.5">
                              <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', zoneColor)} />
                              <span className="text-xs">{lead.leadZone}</span>
                            </span>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </td>

                      <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs text-muted-foreground">{lead.primaryApplicationConfirm || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs text-muted-foreground">{lead.primaryAdmissionConfirm || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs text-muted-foreground">{lead.leadConfirmation || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs text-muted-foreground">{lead.leadStage || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs text-muted-foreground">{lead.leadVerification || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs text-muted-foreground">{lead.dataCallingType || '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-center text-xs text-muted-foreground">{lead.dealType || '—'}</td>

                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(lead.updatedAt)}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{lead.uploadedAt ? fmtDate(lead.uploadedAt) : '—'}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(lead.createdAt)}</td>
                    </motion.tr>
                  );
                })}
                {leads.length === 0 && (
                  <tr>
                    <td colSpan={28} className="px-3 py-16 text-center text-muted-foreground text-sm">
                      No leads found matching the current filters.
                    </td>
                  </tr>
                )}
              </AnimatePresence>
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
          onPageChange={(p) => { setPage(p); setSelectedIds([]); }}
          onLimitChange={(l) => { setLimit(l); setPage(1); setSelectedIds([]); }}
          disabled={isFetching}
          className="mt-3 shrink-0"
        />
      )}

      {selectedLeadId && (
        <LeadDetailDrawer leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} canSubmitFeedback={canSubmitFeedback} />
      )}

      {/* ── Advanced filter picker dialog ────────────────────────────────────── */}
      <Dialog open={filterDialogOpen} onOpenChange={setFilterDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListFilter className="h-4 w-4" />
              Advanced Filters
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Select the filters you want to use. They&apos;ll appear below the filter bar.
            </p>
          </DialogHeader>

          <div className="py-2 space-y-5 max-h-[60vh] overflow-y-auto pr-1">
            {FILTER_GROUPS.map(({ group, filters }) => {
              // hide TL/Agent if the role doesn't show them
              const visible = filters.filter(
                (f) => (f.key !== 'tl' || showTlFilter) && (f.key !== 'agent' || showAgentFilter)
              );
              if (visible.length === 0) return null;
              const allChecked = visible.every((f) => dialogFilters.includes(f.key));
              const someChecked = visible.some((f) => dialogFilters.includes(f.key));
              return (
                <div key={group}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {group}
                    </span>
                    <button
                      onClick={() => {
                        if (allChecked) {
                          setDialogFilters((prev) => prev.filter((k) => !visible.map((f) => f.key).includes(k)));
                        } else {
                          setDialogFilters((prev) => Array.from(new Set([...prev, ...visible.map((f) => f.key)])));
                        }
                      }}
                      className="text-[10px] text-primary hover:underline"
                    >
                      {allChecked ? 'Deselect all' : 'Select all'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {visible.map((f) => {
                      const checked = dialogFilters.includes(f.key);
                      return (
                        <label
                          key={f.key}
                          className={cn(
                            'flex items-center gap-2.5 rounded-md border px-3 py-2 cursor-pointer transition-colors text-sm select-none',
                            checked
                              ? 'border-primary/60 bg-primary/8 text-primary'
                              : 'border-input hover:bg-muted/40'
                          )}
                        >
                          <input
                            type="checkbox"
                            className="rounded border-border accent-primary"
                            checked={checked}
                            onChange={() => toggleDialogFilter(f.key)}
                          />
                          {f.label}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <DialogFooter className="gap-2 pt-2">
            <button
              onClick={() => {
                setDialogFilters([]);
              }}
              className="h-8 px-3 text-xs rounded-md border border-input text-muted-foreground hover:text-foreground transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => setFilterDialogOpen(false)}
              className="h-8 px-3 text-xs rounded-md border border-input text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={applyFilterDialog}
              className="h-8 px-4 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
            >
              Apply Filters
              {dialogFilters.length > 0 && (
                <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary-foreground/20 text-[10px] font-bold">
                  {dialogFilters.length}
                </span>
              )}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
