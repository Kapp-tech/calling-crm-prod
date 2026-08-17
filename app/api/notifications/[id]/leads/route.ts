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

  // Bulk notification — the assign routes record exactly which leads it covers.
  // Still scoped to leads the user currently holds: if one has since been moved
  // to someone else, it is no longer theirs to look at.
  if (notification.leadIds.length > 0) {
    const leads = await prisma.lead.findMany({
      where: { id: { in: notification.leadIds }, assignedToId: session.user.id },
      select: LEAD_SELECT,
      orderBy: { assignedAt: 'desc' },
      take: 100,
    });
    return NextResponse.json(leads);
  }

  // Fallback for notifications written before leadIds existed: match on
  // assignedAt, the field that actually records when a lead was assigned.
  //
  // This used to filter on updatedAt, which worked only while Prisma's
  // @updatedAt bumped that column on every write. Once updatedAt was changed to
  // advance solely on feedback submission, assignment stopped touching it and
  // this query started returning whichever leads happened to receive feedback
  // near the notification's timestamp — unrelated leads, and the wrong count.
  const WINDOW_MS = 5 * 60 * 1000;
  const leads = await prisma.lead.findMany({
    where: {
      assignedToId: session.user.id,
      assignedAt: {
        gte: new Date(notification.createdAt.getTime() - WINDOW_MS),
        lte: new Date(notification.createdAt.getTime() + WINDOW_MS),
      },
    },
    select: LEAD_SELECT,
    orderBy: { assignedAt: 'desc' },
    take: 100,
  });

  return NextResponse.json(leads);
}
