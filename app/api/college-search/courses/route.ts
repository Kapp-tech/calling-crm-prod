import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchLmsCourses } from '@/lib/lms-api';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const collegeId = parseInt(req.nextUrl.searchParams.get('collegeId') ?? '', 10);
    const courseGroupId = parseInt(req.nextUrl.searchParams.get('courseGroupId') ?? '', 10);
    if (!Number.isFinite(collegeId) || !Number.isFinite(courseGroupId)) {
      return NextResponse.json({ error: 'collegeId and courseGroupId are required' }, { status: 400 });
    }

    const data = await fetchLmsCourses(collegeId, courseGroupId).catch(() => null);
    if (data === null) {
      return NextResponse.json({ error: 'Failed to fetch courses' }, { status: 502 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('[college-search/courses GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
