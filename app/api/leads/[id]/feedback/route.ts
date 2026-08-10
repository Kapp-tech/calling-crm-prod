import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { canAccessLead } from '@/lib/lead-access';
import { istWallClockToInstant } from '@/lib/ist-time';
import { Feature } from '@prisma/client';

const feedbackSchema = z.object({
  feedbackOptionId: z.string().min(1, 'Please select a feedback option'),
  remarks:     z.string().trim().min(1, 'Remarks are required').max(1000),
  scheduledAt: z.string().nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const feedbacks = await prisma.leadFeedback.findMany({
      where: { leadId: params.id },
      include: {
        agent: { select: { id: true, name: true } },
        feedbackOption: { select: { id: true, label: true } },
      },
      orderBy: { followUpNumber: 'asc' },
    });
    return NextResponse.json(feedbacks);
  } catch (err) {
    console.error('[lead-feedback GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canSubmit = await hasPermission(session.user.role, Feature.SUBMIT_FEEDBACK);
  if (!canSubmit) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    include: { _count: { select: { feedbacks: true } } },
  });

  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  if (session.user.role === 'COUNSELLING_AGENT' && lead.assignedToId !== session.user.id) {
    return NextResponse.json({ error: 'This lead is not assigned to you' }, { status: 403 });
  }

  const currentCount = lead._count.feedbacks;

  const body = await req.json();
  const parsed = feedbackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const { feedbackOptionId, remarks, scheduledAt } = parsed.data;

    const option = await prisma.feedbackOption.findFirst({
      where: { id: feedbackOptionId, isActive: true },
    });
    if (!option) {
      return NextResponse.json({ error: 'Invalid or inactive feedback option' }, { status: 400 });
    }

    const feedback = await prisma.$transaction(async (tx) => {
      const fb = await tx.leadFeedback.create({
        data: {
          leadId:          params.id,
          agentId:         session.user.id,
          feedbackOptionId,
          remarks:         remarks ?? null,
          followUpNumber:  currentCount + 1,
        },
        include: {
          agent:          { select: { id: true, name: true } },
          feedbackOption: { select: { id: true, label: true } },
        },
      });

      // Keep Lead.currentFeedbackOptionId in sync with the latest feedback
      await tx.lead.update({
        where: { id: params.id },
        data:  { currentFeedbackOptionId: feedbackOptionId },
      });

      if (scheduledAt) {
        // Reads an offset-less wall clock as IST rather than as the server's
        // local time; a value that already carries a zone passes through.
        const scheduledDate = istWallClockToInstant(scheduledAt);
        if (scheduledDate && scheduledDate > new Date()) {
          // Cancel previous pending scheduled calls for this lead + agent
          await tx.scheduledCall.updateMany({
            where: { leadId: params.id, agentId: session.user.id, status: 'PENDING' },
            data:  { status: 'CANCELLED' },
          });
          await tx.scheduledCall.create({
            data: {
              leadId:      params.id,
              agentId:     session.user.id,
              scheduledAt: scheduledDate,
              status:      'PENDING',
            },
          });
        }
      }

      return fb;
    });

    return NextResponse.json({ success: true, ...feedback }, { status: 201 });
  } catch (err) {
    console.error('[lead-feedback POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
