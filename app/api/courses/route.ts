import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const LMS_API_KEY = 'sk_LMS_4e2c91d7a8f34b17b6a4f9b8d93c72fd';
const LMS_BASE = 'https://api.lms.kollegeapply.com/api/leads/unified-data';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const res = await fetch(`${LMS_BASE}?type=course-group`, {
      headers: { 'x-api-key': LMS_API_KEY },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch courses' }, { status: 502 });
    }

    const json = await res.json();

    // Normalize: LMS returns { data: [...] } or similar
    const raw: Record<string, unknown>[] = Array.isArray(json)
      ? json
      : Array.isArray(json?.data)
      ? json.data
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
