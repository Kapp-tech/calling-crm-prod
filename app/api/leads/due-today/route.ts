import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Recent feedbacks for this agent: today + last 7 days
  const feedbacks = await prisma.leadFeedback.findMany({
    where: {
      agentId: session.user.id,
      createdAt: { gte: sevenDaysAgo },
    },
    include: {
      feedbackOption: { select: { id: true, label: true } },
      lead: {
        select: {
          id: true, name: true, phone: true, email: true, city: true,
          course: true, campaign: true, status: true,
          _count: { select: { feedbacks: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  const todayList = feedbacks.filter((f) => f.createdAt >= startOfToday);
  const recentList = feedbacks.filter((f) => f.createdAt < startOfToday && f.createdAt >= startOfYesterday);
  const olderList = feedbacks.filter((f) => f.createdAt < startOfYesterday).slice(0, 10);

  return NextResponse.json({
    today: todayList,
    recent: recentList,
    older: olderList,
    total: feedbacks.length,
  });
  } catch (error) {
    console.error('[leads/due-today GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
