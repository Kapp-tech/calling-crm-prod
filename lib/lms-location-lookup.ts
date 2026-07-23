import { fetchLmsCityRecords, fetchLmsStateRecords } from '@/lib/lms-api';

// Resolves a CRM city/state NAME to the LMS's own numeric city_id/state_id —
// used by the Lead Integration body template (cityId/stateId fields) so a
// push can send the LMS's own IDs instead of free-text names. Never throws:
// a slow/down unified-data endpoint should degrade to a missing ID, not
// break the lead push (name/email/phone etc. can still go through).

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export async function resolveCityId(cityName: string | null | undefined): Promise<number | null> {
  if (!cityName?.trim()) return null;
  try {
    const cities = await fetchLmsCityRecords();
    const target = normalize(cityName);
    const match = cities.find((c) => normalize(c.city_name) === target);
    return match?.city_id ?? null;
  } catch (err) {
    console.error('[lms-location-lookup] resolveCityId failed', err);
    return null;
  }
}

export async function resolveStateId(stateName: string | null | undefined): Promise<number | null> {
  if (!stateName?.trim()) return null;
  try {
    const states = await fetchLmsStateRecords();
    const target = normalize(stateName);
    const match = states.find((s) => normalize(s.name) === target);
    return match?.state_id ?? null;
  } catch (err) {
    console.error('[lms-location-lookup] resolveStateId failed', err);
    return null;
  }
}
