import Papa from 'papaparse';

export interface LeadCSVRow {
  name: string;
  email: string;
  phone: string;
  city?: string;
  state?: string;
  course?: string;
  college?: string;
  campaign?: string;
  lead_type?: string;
  lead_origin?: string;
  lead_zone?: string;
  lead_confirmation?: string;
  lead_stage?: string;
  lead_verification?: string;
  data_calling_type?: string;
  created_at?: string;
}

export interface RowValidationResult {
  rowNumber: number; // 1-based row in CSV (header = 1, data starts at 2)
  raw: LeadCSVRow;
  errors: string[];
  normalized: LeadCSVRow; // normalised (canonical casing) — only reliable when errors is empty
}

export interface ValidationMaps {
  cityMap: Map<string, string>;         // lowercase → canonical
  stateMap: Map<string, string>;
  courseMap: Map<string, string>;
  kappCollegeIdMap: Map<string, string>; // kappCollegeId.lower → college name
}

// ─── CSV parsing ──────────────────────────────────────────────────────────────

export function parseCSV(file: File): Promise<LeadCSVRow[]> {
  return new Promise((resolve, reject) => {
    Papa.parse<LeadCSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (results) => {
        if (results.errors.length > 0) {
          reject(new Error(`CSV parse error: ${results.errors[0].message}`));
          return;
        }
        resolve(results.data);
      },
      error: (error) => reject(error),
    });
  });
}

// ─── Per-row detailed validation ──────────────────────────────────────────────

export function validateRowDetailed(
  row: LeadCSVRow,
  rowNumber: number,
  maps?: ValidationMaps,
): RowValidationResult {
  const errors: string[] = [];
  const normalized: LeadCSVRow = { ...row };

  // ── Name ──
  const name = row.name?.trim() ?? '';
  if (!name) {
    errors.push('Name is required');
  } else if (name.length < 2) {
    errors.push('Name must be at least 2 characters');
  } else if (!/^[a-zA-Z\s]+$/.test(name)) {
    errors.push('Name must contain only letters and spaces (no digits or symbols)');
  }
  normalized.name = name;

  // ── Email ──
  const email = row.email?.trim() ?? '';
  if (!email) {
    errors.push('Email is required');
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push(`Invalid email "${email}"`);
  }
  normalized.email = email.toLowerCase();

  // ── Phone ──
  const phone = row.phone?.trim() ?? '';
  if (!phone) {
    errors.push('Phone is required');
  } else if (!/^\d{10}$/.test(phone)) {
    errors.push('Phone must be exactly 10 digits');
  } else if (!/^[6-9]/.test(phone)) {
    errors.push('Phone must start with 6, 7, 8, or 9');
  }
  normalized.phone = phone;

  // ── City (optional, validate if provided) ──
  const city = row.city?.trim() ?? '';
  if (city) {
    if (maps) {
      const canonical = maps.cityMap.get(city.toLowerCase());
      if (!canonical) {
        errors.push(`City "${city}" is not in the valid list`);
      } else {
        normalized.city = canonical;
      }
    } else {
      normalized.city = city;
    }
  } else {
    normalized.city = '';
  }

  // ── State (optional, validate if provided) ──
  const state = row.state?.trim() ?? '';
  if (state) {
    if (maps) {
      const canonical = maps.stateMap.get(state.toLowerCase());
      if (!canonical) {
        errors.push(`State "${state}" is not in the valid list`);
      } else {
        normalized.state = canonical;
      }
    } else {
      normalized.state = state;
    }
  } else {
    normalized.state = '';
  }

  // ── Course (optional, validate if provided) ──
  const course = row.course?.trim() ?? '';
  if (course) {
    if (maps) {
      const canonical = maps.courseMap.get(course.toLowerCase());
      if (!canonical) {
        errors.push(`Course "${course}" is not in the valid list`);
      } else {
        normalized.course = canonical;
      }
    } else {
      normalized.course = course;
    }
  } else {
    normalized.course = '';
  }

  // ── College (required — value in CSV is a KAPP College ID) ──
  const college = row.college?.trim() ?? '';
  if (!college) {
    errors.push('College is required');
    normalized.college = '';
  } else if (maps && maps.kappCollegeIdMap.size > 0) {
    const resolvedName = maps.kappCollegeIdMap.get(college.toLowerCase());
    if (!resolvedName) {
      errors.push(`College "${college}" is not a valid KAPP College ID`);
    } else {
      normalized.college = college; // keep the KAPP ID as-is; backend resolves to name
    }
  } else {
    normalized.college = college;
  }

  return { rowNumber, raw: row, errors, normalized };
}

// ─── Result CSV generation ────────────────────────────────────────────────────

export function buildResultCSV(
  results: RowValidationResult[],
  duplicateEmails?: Set<string>,
): string {
  const headers = [
    'row', 'name', 'email', 'phone', 'city', 'state',
    'course', 'college', 'campaign', 'lead_type', 'lead_origin', 'lead_zone',
    'lead_confirmation', 'lead_stage', 'lead_verification', 'data_calling_type',
    'created_at',
    'status', 'issues',
  ];

  const rows = results.map((r) => {
    let status: string;
    let issues: string;

    if (r.errors.length > 0) {
      status = 'Failed';
      issues = r.errors.join('; ');
    } else if (duplicateEmails?.has(r.normalized.email.toLowerCase())) {
      status = 'Duplicate';
      issues = 'Email already exists in the system';
    } else {
      status = 'Uploaded';
      issues = '';
    }

    const d = r.raw;
    return [
      r.rowNumber,
      csvEscape(d.name ?? ''),
      csvEscape(d.email ?? ''),
      csvEscape(d.phone ?? ''),
      csvEscape(d.city ?? ''),
      csvEscape(d.state ?? ''),
      csvEscape(d.course ?? ''),
      csvEscape(d.college ?? ''),
      csvEscape(d.campaign ?? ''),
      csvEscape(d.lead_type ?? ''),
      csvEscape(d.lead_origin ?? ''),
      csvEscape(d.lead_zone ?? ''),
      csvEscape(d.lead_confirmation ?? ''),
      csvEscape(d.lead_stage ?? ''),
      csvEscape(d.lead_verification ?? ''),
      csvEscape(d.data_calling_type ?? ''),
      csvEscape(d.created_at ?? ''),
      status,
      csvEscape(issues),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

// ─── Legacy single-error validation (kept for backward compat) ────────────────

export function validateLeadRow(row: LeadCSVRow): string | null {
  const r = validateRowDetailed(row, 0);
  return r.errors.length > 0 ? r.errors[0] : null;
}

// ─── Masking helpers ──────────────────────────────────────────────────────────

export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 2)}${'*'.repeat(phone.length - 4)}${phone.slice(-2)}`;
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(0, local.length - 2))}@${domain}`;
}
