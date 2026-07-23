import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

const PAGE_SIZE = 30;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const cursor = req.nextUrl.searchParams.get('cursor');

    const logs = await prisma.leadIntegrationLog.findMany({
      where: { integrationId: params.id },
      orderBy: { attemptedAt: 'desc' },
      take: PAGE_SIZE + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      include: { lead: { select: { id: true, name: true } } },
    });

    const hasMore = logs.length > PAGE_SIZE;
    const page = hasMore ? logs.slice(0, PAGE_SIZE) : logs;

    return NextResponse.json({ logs: page, nextCursor: hasMore ? page[page.length - 1].id : null });
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id]/logs GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
