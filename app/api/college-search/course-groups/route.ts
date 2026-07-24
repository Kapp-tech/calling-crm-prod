import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchLmsCourseGroups, fetchLmsCourses } from '@/lib/lms-api';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const collegeId = parseInt(req.nextUrl.searchParams.get('collegeId') ?? '', 10);
    if (!Number.isFinite(collegeId)) {
      return NextResponse.json({ error: 'collegeId is required' }, { status: 400 });
    }

    const groups = await fetchLmsCourseGroups(collegeId).catch(() => null);
    if (groups === null) {
      return NextResponse.json({ error: 'Failed to fetch course groups' }, { status: 502 });
    }

    // The upstream group list doesn't include how many individual courses
    // live under each group — fetch that count per group in parallel. Each
    // of these calls shares the same 1-hour fetch cache as the "Courses"
    // drill-down view, so this is only ever a real network fan-out once per
    // college per hour; every repeat view (or the user actually opening a
    // group) is served from cache.
    const data = await Promise.all(
      groups.map(async (g) => {
        const courses = await fetchLmsCourses(collegeId, g.course_group_id).catch(() => []);
        return { ...g, courseCount: courses.length };
      })
    );

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[college-search/course-groups GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
