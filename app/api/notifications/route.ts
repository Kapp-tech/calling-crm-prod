import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { createDueScheduledCallNotifications } from '@/lib/scheduled-call-notifications';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const userId = session.user.id;

    await createDueScheduledCallNotifications(userId);

    // ── Return latest 50 notifications ─────────────────────────────────────────
    const notifications = await prisma.notification.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' }, take: 50,
    });
    return NextResponse.json(notifications);
  } catch (err) {
    console.error('[notifications GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Mark all as read
export async function PATCH() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await prisma.notification.updateMany({
      where: { userId: session.user.id, read: false },
      data:  { read: true },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[notifications PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
