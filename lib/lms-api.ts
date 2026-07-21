// Shared client for the external KollegeApply LMS "unified data" API — the
// single source of truth for valid City / State / Course values across CSV
// upload, the Single Add Lead form, and the external lead-ingestion API
// (app/api/v1/leads). Keeping the fetch in one place means all three paths
// validate against the exact same list.

const LMS_API_KEY = 'sk_LMS_4e2c91d7a8f34b17b6a4f9b8d93c72fd';
const LMS_BASE = 'https://api.lms.kollegeapply.com/api/leads/unified-data';

export type LmsDataType = 'state' | 'city' | 'course-group';

export async function fetchLmsUnifiedData(type: LmsDataType): Promise<unknown> {
  const res = await fetch(`${LMS_BASE}?type=${type}`, {
    headers: { 'x-api-key': LMS_API_KEY },
    next: { revalidate: 3600 },
  });
  if (!res.ok) {
    throw new Error(`LMS API request failed for type=${type}: HTTP ${res.status}`);
  }
  return res.json();
}

/** Canonical city names, e.g. ["Mumbai", "Pune", ...]. */
export async function fetchLmsCityNames(): Promise<string[]> {
  const json = await fetchLmsUnifiedData('city');
  const list = (json as { data?: { city_name?: string }[] })?.data ?? [];
  return list.map((c) => c.city_name).filter((v): v is string => !!v);
}

/** Canonical state names, e.g. ["Maharashtra", "Rajasthan", ...]. */
export async function fetchLmsStateNames(): Promise<string[]> {
  const json = await fetchLmsUnifiedData('state');
  const list = (json as { data?: { name?: string }[] })?.data ?? [];
  return list.map((s) => s.name).filter((v): v is string => !!v);
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
