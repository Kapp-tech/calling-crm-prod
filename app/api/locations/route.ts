import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

const LMS_API_KEY = 'sk_LMS_4e2c91d7a8f34b17b6a4f9b8d93c72fd';
const LMS_BASE = 'https://api.lms.kollegeapply.com/api/leads/unified-data';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const type = req.nextUrl.searchParams.get('type');
    if (type !== 'state' && type !== 'city') {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    const res = await fetch(`${LMS_BASE}?type=${type}`, {
      headers: { 'x-api-key': LMS_API_KEY },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch locations' }, { status: 502 });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('[locations GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
