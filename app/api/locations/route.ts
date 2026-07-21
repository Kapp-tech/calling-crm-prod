import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { fetchLmsUnifiedData } from '@/lib/lms-api';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const type = req.nextUrl.searchParams.get('type');
    if (type !== 'state' && type !== 'city') {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    const data = await fetchLmsUnifiedData(type).catch(() => null);
    if (data === null) {
      return NextResponse.json({ error: 'Failed to fetch locations' }, { status: 502 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('[locations GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
