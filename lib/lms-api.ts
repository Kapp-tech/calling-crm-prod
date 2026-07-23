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

/** Canonical course names, e.g. ["B.Tech", "MBA/PGDM", ...]. */
export async function fetchLmsCourseNames(): Promise<string[]> {
  const json = await fetchLmsUnifiedData('course-group');
  const raw: Record<string, unknown>[] = Array.isArray(json)
    ? (json as Record<string, unknown>[])
    : Array.isArray((json as { data?: unknown })?.data)
    ? ((json as { data: Record<string, unknown>[] }).data)
    : [];
  return raw
    .map((item) => (item.name ?? item.group_name ?? item.course_name) as string | undefined)
    .filter((v): v is string => !!v);
}

/** Builds a lowercase-name → canonical-name map for case-insensitive matching. */
export function toCanonicalMap(names: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of names) map.set(n.trim().toLowerCase(), n.trim());
  return map;
}
