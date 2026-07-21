import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchLmsUnifiedData } from '@/lib/lms-api';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const json = await fetchLmsUnifiedData('course-group').catch(() => null);
    if (json === null) {
      return NextResponse.json({ error: 'Failed to fetch courses' }, { status: 502 });
    }

    // Normalize: LMS returns { data: [...] } or similar
    const raw: Record<string, unknown>[] = Array.isArray(json)
      ? json
      : Array.isArray((json as { data?: unknown })?.data)
      ? (json as { data: Record<string, unknown>[] }).data
      : [];

    const normalized = raw.map((item, idx) => ({
      id: (item.id ?? item.course_id ?? item.group_id ?? idx) as number | string,
      name: (item.name ?? item.group_name ?? item.course_name ?? String(item.id ?? idx)) as string,
    }));

    return NextResponse.json(normalized);
  } catch (error) {
    console.error('[courses GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
