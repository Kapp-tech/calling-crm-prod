import { fetchLmsCourseGroupRecords } from '@/lib/lms-api';

// Resolves a CRM course NAME (e.g. "B.Tech") to the LMS's own numeric
// course_group_id — the counterpart of lib/lms-location-lookup.ts, used by the
// Lead Integration body template's `courseId` field so a push can send the id
// the LMS expects rather than the display name.
//
// Note this is the course-GROUP id (small ints, e.g. B.Tech = 334), not an
// individual course id (5-digit). That's the granularity the CRM stores:
// Lead.course is validated against unified-data?type=course-group.
//
// Never throws — a slow or down upstream degrades to a missing id rather than
// failing the whole lead push.

export async function resolveCourseGroupId(courseName: string | null | undefined): Promise<number | null> {
  if (!courseName?.trim()) return null;
  try {
    const records = await fetchLmsCourseGroupRecords();
    const target = courseName.trim().toLowerCase();
    const match = records.find((r) => r.name.trim().toLowerCase() === target);
    return match?.course_group_id ?? null;
  } catch (err) {
    console.error('[lms-course-lookup] resolveCourseGroupId failed', err);
    return null;
  }
}
