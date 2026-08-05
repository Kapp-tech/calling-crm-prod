// Shared client for the external KollegeApply LMS "unified data" API — the
// single source of truth for valid City / State / Course values across CSV
// upload, the Single Add Lead form, and the external lead-ingestion API
// (app/api/v1/leads). Keeping the fetch in one place means all three paths
// validate against the exact same list.

const LMS_API_KEY = 'sk_LMS_4e2c91d7a8f34b17b6a4f9b8d93c72fd';
const LMS_BASE = 'https://api.lms.kollegeapply.com/api/leads/unified-data';

export type LmsDataType = 'state' | 'city' | 'course-group';

// A cold cache (first request after deploy, or once per hour thereafter)
// means this call actually hits the external provider. Without a timeout, a
// slow or unresponsive upstream would hang the caller indefinitely — bound
// it so a flaky external API fails fast with a clear error instead.
const FETCH_TIMEOUT_MS = 8_000;

export async function fetchLmsUnifiedData(type: LmsDataType): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${LMS_BASE}?type=${type}`, {
      headers: { 'x-api-key': LMS_API_KEY },
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`LMS API request failed for type=${type}: HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`LMS API request for type=${type} timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export interface LmsCityRecord {
  city_id: number;
  city_name: string;
  state_id: number;
  state_name: string;
}

export interface LmsStateRecord {
  state_id: number;
  name: string;
}

/** Full city records (id + name + parent state) — the source of truth for the LMS's own city_id, used by lib/lms-location-lookup.ts. */
export async function fetchLmsCityRecords(): Promise<LmsCityRecord[]> {
  const json = await fetchLmsUnifiedData('city');
  const list = (json as { data?: LmsCityRecord[] })?.data ?? [];
  return list.filter((c) => !!c.city_name);
}

/** Full state records (id + name) — the source of truth for the LMS's own state_id, used by lib/lms-location-lookup.ts. */
export async function fetchLmsStateRecords(): Promise<LmsStateRecord[]> {
  const json = await fetchLmsUnifiedData('state');
  const list = (json as { data?: LmsStateRecord[] })?.data ?? [];
  return list.filter((s) => !!s.name);
}

/** Canonical city names, e.g. ["Mumbai", "Pune", ...]. */
export async function fetchLmsCityNames(): Promise<string[]> {
  const records = await fetchLmsCityRecords();
  return records.map((c) => c.city_name);
}

/** Canonical state names, e.g. ["Maharashtra", "Rajasthan", ...]. */
export async function fetchLmsStateNames(): Promise<string[]> {
  const records = await fetchLmsStateRecords();
  return records.map((s) => s.name);
}

/** The course-group endpoint has been seen returning both a bare array and a
 * `{ data: [...] }` envelope, so normalize before reading either shape. */
async function fetchCourseGroupRows(): Promise<Record<string, unknown>[]> {
  const json = await fetchLmsUnifiedData('course-group');
  return Array.isArray(json)
    ? (json as Record<string, unknown>[])
    : Array.isArray((json as { data?: unknown })?.data)
    ? (json as { data: Record<string, unknown>[] }).data
    : [];
}

function courseGroupName(item: Record<string, unknown>): string | undefined {
  return (item.name ?? item.group_name ?? item.course_name) as string | undefined;
}

/** Canonical course names, e.g. ["B.Tech", "MBA/PGDM", ...]. */
export async function fetchLmsCourseNames(): Promise<string[]> {
  const raw = await fetchCourseGroupRows();
  // Deliberately does NOT require a usable id — this list backs CSV-upload and
  // lead-ingestion validation, so a row with a name but no id must still be
  // accepted rather than silently rejecting a legitimate course.
  return raw.map(courseGroupName).filter((v): v is string => !!v);
}

export interface LmsCourseGroupRecord {
  course_group_id: number;
  name: string;
}

/** Course-group records (id + name) — the source of truth for the LMS's own
 * course_group_id, used by lib/lms-course-lookup.ts. */
export async function fetchLmsCourseGroupRecords(): Promise<LmsCourseGroupRecord[]> {
  const raw = await fetchCourseGroupRows();
  return raw
    .map((item) => ({
      course_group_id: Number(item.course_group_id ?? item.id),
      name: courseGroupName(item),
    }))
    .filter((r): r is LmsCourseGroupRecord => !!r.name && Number.isFinite(r.course_group_id));
}

/** Builds a lowercase-name → canonical-name map for case-insensitive matching. */
export function toCanonicalMap(names: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of names) map.set(n.trim().toLowerCase(), n.trim());
  return map;
}

// ─── College/Course Search ──────────────────────────────────────────────────
// A different upstream endpoint (college-course-lookup, not unified-data) on
// the same LMS host/key — backs the College/Course Search page's fee and
// brochure lookup. Kept in this file since it's the same external client
// and API key, just a different resource.

const COLLEGE_COURSE_LOOKUP_BASE = 'https://api.lms.kollegeapply.com/api/leads/college-course-lookup';

export interface LmsBrochure {
  brochure_file: string;
  brochure_title: string;
}

export interface LmsCollegeSearchResult {
  college_id: number;
  college_name: string;
  short_name: string | null;
  /** Absolute URL. Served from several different hosts (S3, CloudFront,
   *  assets.kollegeapply.com) in jpg/png/svg/gif, so render it with a plain
   *  <img> rather than next/image — see the CollegeLogo component. */
  logo_img: string | null;
  city_name: string | null;
  state_name: string | null;
  slug: string;
  brochures: LmsBrochure[];
}

export interface LmsCollegeSearchResponse {
  data: LmsCollegeSearchResult[];
  total: number;
  page: number;
  limit: number;
}

export interface LmsExamAccepted {
  name: string;
  slug: string;
}

export interface LmsCourseGroup {
  course_group_id: number;
  course_group_name: string;
  course_group_full_name: string;
  duration: string | null;
  median_salary: string | null;
  min_fees: string | null;
  max_fees: string | null;
  course_mode: string | null;
  exam_accepted: LmsExamAccepted[];
  eligibility: string | null;
  brochures: LmsBrochure[];
}

export interface LmsCourse {
  course_id: number;
  course_name: string;
  duration_type: string | null;
  course_mode: string | null;
  median_salary: string | null;
  min_fees: string | null;
  max_fees: string | null;
  exam_accepted: LmsExamAccepted[];
  course_brochure: unknown[];
  brochures: LmsBrochure[];
}

async function fetchCollegeCourseLookup(params: Record<string, string | number>): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  try {
    const res = await fetch(`${COLLEGE_COURSE_LOOKUP_BASE}?${qs}`, {
      headers: { 'x-api-key': LMS_API_KEY },
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`College/course lookup failed for ${qs}: HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`College/course lookup for ${qs} timed out after ${FETCH_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** Paginated college search — server-side `search` matches college name, city, and state. */
export async function searchLmsColleges(opts: {
  search?: string;
  page: number;
  limit: number;
}): Promise<LmsCollegeSearchResponse> {
  const params: Record<string, string | number> = { option: 'college', page: opts.page, limit: opts.limit };
  if (opts.search?.trim()) params.search = opts.search.trim();
  const json = (await fetchCollegeCourseLookup(params)) as Partial<LmsCollegeSearchResponse>;
  return {
    data: json.data ?? [],
    total: json.total ?? 0,
    page: json.page ?? opts.page,
    limit: json.limit ?? opts.limit,
  };
}

/** Full (unpaginated) course-group list for one college. */
export async function fetchLmsCourseGroups(collegeId: number): Promise<LmsCourseGroup[]> {
  const json = (await fetchCollegeCourseLookup({ option: 'course_group', college_id: collegeId })) as { data?: LmsCourseGroup[] };
  return json.data ?? [];
}

/** Full (unpaginated) course list for one college + course group. */
export async function fetchLmsCourses(collegeId: number, courseGroupId: number): Promise<LmsCourse[]> {
  const json = (await fetchCollegeCourseLookup({
    option: 'course',
    college_id: collegeId,
    course_group_id: courseGroupId,
  })) as { data?: LmsCourse[] };
  return json.data ?? [];
}
