/**
 * Lead "profiling percentage" — how thoroughly a counsellor has filled in
 * the Lead Profile wizard for a given lead.
 *
 * No field in the wizard is mandatory — every field carries equal weight.
 * Scoring is a flat count: percentage = fields filled / total fields.
 */

interface ProfilingProfileInput {
  preferredCourseIds?: unknown;
  preferredCollegeIds?: unknown;
  preferredCityNames?: unknown;
  preferredStateNames?: unknown;
  courseType?: string | null;
  collegeType?: string | null;
  specialisation?: string | null;
  entranceExam?: unknown;
  budget?: string | null;
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
}

export interface ProfilingLeadInput {
  name?: string | null;
  phone?: string | null;
  city?: string | null;
  classYear?: string | null;
  email?: string | null;
  state?: string | null;
  parentName?: string | null;
  parentMobile?: string | null;
  gender?: string | null;
  category?: string | null;
  profile?: ProfilingProfileInput | null;
}

type FieldStep = 'Basic Info' | 'Preferences' | 'Budget' | 'Stay' | 'Academics';

interface ProfilingField {
  key: string;
  label: string;
  step: FieldStep;
  getValue: (lead: ProfilingLeadInput) => unknown;
}

function isFilled(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export const PROFILING_FIELDS: ProfilingField[] = [
  // Basic Info
  { key: 'name',         label: 'Name',                   step: 'Basic Info', getValue: (l) => l.name },
  { key: 'phone',        label: 'Phone',                  step: 'Basic Info', getValue: (l) => l.phone },
  { key: 'city',         label: 'City',                   step: 'Basic Info', getValue: (l) => l.city },
  { key: 'classYear',    label: 'Current Class / Year',   step: 'Basic Info', getValue: (l) => l.classYear },
  { key: 'email',        label: 'Email',                  step: 'Basic Info', getValue: (l) => l.email },
  { key: 'state',        label: 'State',                  step: 'Basic Info', getValue: (l) => l.state },
  { key: 'parentName',   label: 'Parent / Guardian Name', step: 'Basic Info', getValue: (l) => l.parentName },
  { key: 'parentMobile', label: 'Parent Mobile',          step: 'Basic Info', getValue: (l) => l.parentMobile },
  { key: 'gender',       label: 'Gender',                 step: 'Basic Info', getValue: (l) => l.gender },
  { key: 'category',     label: 'Category',               step: 'Basic Info', getValue: (l) => l.category },

  // Preferences (Course / College)
  { key: 'preferredCourseIds',  label: 'Course(s) Interested In',  step: 'Preferences', getValue: (l) => l.profile?.preferredCourseIds },
  { key: 'courseType',          label: 'Preferred Course Type',    step: 'Preferences', getValue: (l) => l.profile?.courseType },
  { key: 'specialisation',      label: 'Specialisation / Branch',  step: 'Preferences', getValue: (l) => l.profile?.specialisation },
  { key: 'preferredCollegeIds', label: 'College(s) Interested In', step: 'Preferences', getValue: (l) => l.profile?.preferredCollegeIds },
  { key: 'collegeType',         label: 'Preferred College Type',   step: 'Preferences', getValue: (l) => l.profile?.collegeType },
  { key: 'preferredCityNames',  label: 'City Preference',          step: 'Preferences', getValue: (l) => l.profile?.preferredCityNames },
  { key: 'preferredStateNames', label: 'State Preference',         step: 'Preferences', getValue: (l) => l.profile?.preferredStateNames },
  { key: 'entranceExam',        label: 'Entrance Exams',           step: 'Preferences', getValue: (l) => l.profile?.entranceExam },

  // Budget & Finance
  { key: 'budget',                label: 'Total Course Budget',     step: 'Budget', getValue: (l) => l.profile?.budget },
  { key: 'scholarshipAwareness',  label: 'Scholarship Awareness',   step: 'Budget', getValue: (l) => l.profile?.scholarshipAwareness },
  { key: 'loanRequirement',       label: 'Loan Requirement',        step: 'Budget', getValue: (l) => l.profile?.loanRequirement },
  { key: 'loanAmount',            label: 'Loan Amount Required',    step: 'Budget', getValue: (l) => l.profile?.loanAmount },
  { key: 'paymentModePreference', label: 'Payment Mode Preference', step: 'Budget', getValue: (l) => l.profile?.paymentModePreference },

  // Accommodation & Stay
  { key: 'stayPreference',             label: 'Stay Preference',              step: 'Stay', getValue: (l) => l.profile?.stayPreference },
  { key: 'monthlyAccommodationBudget', label: 'Monthly Accommodation Budget', step: 'Stay', getValue: (l) => l.profile?.monthlyAccommodationBudget },
  { key: 'roomSharing',                label: 'Room Sharing Preference',      step: 'Stay', getValue: (l) => l.profile?.roomSharing },
  { key: 'mealsPreference',            label: 'Meals / Food Preference',      step: 'Stay', getValue: (l) => l.profile?.mealsPreference },
  { key: 'keyAmenities',               label: 'Key Amenity Requirements',     step: 'Stay', getValue: (l) => l.profile?.keyAmenities },
  { key: 'distanceWillingness',        label: 'Distance Willingness',         step: 'Stay', getValue: (l) => l.profile?.distanceWillingness },
  { key: 'genderHostelRequirement',    label: 'Gender Hostel Requirement',    step: 'Stay', getValue: (l) => l.profile?.genderHostelRequirement },

  // Academics
  { key: 'class10Percentage',   label: 'Class 10 Percentage / CGPA', step: 'Academics', getValue: (l) => l.profile?.class10Percentage },
  { key: 'class12Percentage',   label: 'Class 12 Percentage / CGPA', step: 'Academics', getValue: (l) => l.profile?.class12Percentage },
  { key: 'board',               label: 'Board',                      step: 'Academics', getValue: (l) => l.profile?.board },
  { key: 'gapYearReason',       label: 'Gap Year / Break Reason',    step: 'Academics', getValue: (l) => l.profile?.gapYearReason },
  { key: 'mediumOfInstruction', label: 'Medium of Instruction',      step: 'Academics', getValue: (l) => l.profile?.mediumOfInstruction },
];

export interface ProfilingScore {
  percentage: number;
  filled: number;
  total: number;
  missingFields: { label: string; step: FieldStep }[];
}

export function computeProfilingScore(lead: ProfilingLeadInput): ProfilingScore {
  const missingFields: ProfilingScore['missingFields'] = [];

  let filled = 0;
  for (const field of PROFILING_FIELDS) {
    if (isFilled(field.getValue(lead))) filled++;
    else missingFields.push({ label: field.label, step: field.step });
  }

  const total = PROFILING_FIELDS.length;

  return {
    percentage: total > 0 ? Math.round((filled / total) * 100) : 0,
    filled,
    total,
    missingFields,
  };
}

/** Shared red/amber/emerald tone thresholds so every surface (profile page,
 *  drawer, leads table) colours the percentage the same way. */
export function profilingScoreTone(pct: number) {
  if (pct >= 80) {
    return {
      ring: '#10b981',
      text: 'text-emerald-600 dark:text-emerald-400',
      bar: 'bg-emerald-500',
      chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
    };
  }
  if (pct >= 50) {
    return {
      ring: '#f59e0b',
      text: 'text-amber-600 dark:text-amber-400',
      bar: 'bg-amber-500',
      chip: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
    };
  }
  return {
    ring: '#ef4444',
    text: 'text-red-600 dark:text-red-400',
    bar: 'bg-red-500',
    chip: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  };
}
