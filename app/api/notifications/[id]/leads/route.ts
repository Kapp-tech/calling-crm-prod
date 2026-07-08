import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const LEAD_SELECT = {
  id: true,
  name: true,
  phone: true,
  city: true,
  course: true,
  campaign: true,
  status: true,
  currentFeedbackOptionId: true,
  _count: { select: { feedbacks: true } },
  feedbacks: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: {
      feedbackOption: { select: { id: true, label: true } },
      remarks: true,
      createdAt: true,
    },
  },
} as const;

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const notification = await prisma.notification.findFirst({
    where: { id: params.id, userId: session.user.id, type: 'LEAD_ASSIGNED' },
  });

  if (!notification) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Single lead notification
  if (notification.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: notification.leadId },
      select: LEAD_SELECT,
    });
    return NextResponse.json(lead ? [lead] : []);
  }

  // Bulk notification — find leads assigned to this user within ±5 min of notification
  const WINDOW_MS = 5 * 60 * 1000;
  const leads = await prisma.lead.findMany({
    where: {
      assignedToId: session.user.id,
      updatedAt: {
        gte: new Date(notification.createdAt.getTime() - WINDOW_MS),
        lte: new Date(notification.createdAt.getTime() + WINDOW_MS),
      },
    },
    select: LEAD_SELECT,
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });

  return NextResponse.json(leads);
}
