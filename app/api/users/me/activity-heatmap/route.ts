import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Daily feedback counts for the logged-in user over the last ~6 months.
// Backs the GitHub-style activity heatmap on the profile page.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 181);

    const feedbacks = await prisma.leadFeedback.findMany({
      where: { agentId: session.user.id, createdAt: { gte: start } },
      select: { createdAt: true },
    });

    const counts = new Map<string, number>();
    for (const f of feedbacks) {
      const key = f.createdAt.toISOString().split('T')[0];
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return NextResponse.json(
      Array.from(counts.entries()).map(([date, count]) => ({ date, count }))
    );
  } catch (error) {
    console.error('[users/me/activity-heatmap GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
