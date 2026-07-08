import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Returns the count of PENDING leads — for TL awareness banner.
 * TL cannot see the actual leads, only the count, so they know approval is in progress.
 */
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const count = await prisma.lead.count({ where: { status: 'PENDING' } });
    return NextResponse.json({ count });
  } catch (error) {
    console.error('[leads/pending-count GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
