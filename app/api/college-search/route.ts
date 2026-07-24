import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchLmsColleges } from '@/lib/lms-api';

// Read-only catalog lookup (fees/brochures) — open to any signed-in role,
// same posture as /api/locations. No PIN gate: no PII, nothing destructive.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const params = req.nextUrl.searchParams;
    const search = params.get('search') ?? undefined;
    const page = Math.max(1, parseInt(params.get('page') ?? '1', 10) || 1);
    // Upstream silently clamps to 100 anyway — clamp here too so the UI's
    // requested limit and the response's actual limit never disagree.
    const limit = Math.min(100, Math.max(1, parseInt(params.get('limit') ?? '25', 10) || 25));

    const result = await searchLmsColleges({ search, page, limit }).catch(() => null);
    if (!result) {
      return NextResponse.json({ error: 'Failed to fetch colleges' }, { status: 502 });
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('[college-search GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
