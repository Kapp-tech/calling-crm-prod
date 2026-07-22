import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { Feature } from '@prisma/client';

const assignSchema = z.object({
  agentId:        z.string().min(1, 'Agent ID is required'),
  resetFeedbacks: z.boolean().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canAssign = await hasPermission(session.user.role, Feature.ASSIGN_LEADS);
  if (!canAssign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const parsed = assignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { agentId, resetFeedbacks } = parsed.data;

  // Verify agent belongs to this TL — check via managedById OR team membership
  if (session.user.role === 'COUNSELLING_TL') {
    const agent = await prisma.user.findFirst({
      where: {
        id: agentId,
        role: 'COUNSELLING_AGENT',
        OR: [
          { managedById: session.user.id },
          { team: { teamLeadId: session.user.id } },
        ],
      },
    });
    if (!agent) {
      return NextResponse.json({ success: false, error: 'Agent not under your management', code: 'FORBIDDEN' }, { status: 403 });
    }
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { status: true, assignedToId: true, assignedFromId: true, assignedById: true, currentCycle: true },
  });
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  if (lead.status !== 'APPROVED') {
    return NextResponse.json({ error: 'Only approved leads can be assigned' }, { status: 400 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (resetFeedbacks) {
      // Archive the outgoing agent's feedback instead of destroying it — TL /
      // Super Admin can still see it (Timeline, Calls tab), while the live
      // `feedbacks` relation is cleared so the newly-assigned agent sees a
      // clean lead.
      const existingFeedbacks = await tx.leadFeedback.findMany({ where: { leadId: params.id } });
      if (existingFeedbacks.length > 0) {
        await tx.leadFeedbackArchive.createMany({
          data: existingFeedbacks.map((fb) => ({
            leadId:           fb.leadId,
            agentId:          fb.agentId,
            feedbackOptionId: fb.feedbackOptionId,
            remarks:          fb.remarks,
            followUpNumber:   fb.followUpNumber,
            createdAt:        fb.createdAt,
            cycle:            lead.currentCycle,
            archivedById:     session.user.id,
          })),
        });
        await tx.leadFeedback.deleteMany({ where: { leadId: params.id } });
      }
      await tx.scheduledCall.updateMany({
        where: { leadId: params.id, status: 'PENDING' },
        data:  { status: 'CANCELLED' },
      });
    }
    return tx.lead.update({
      where: { id: params.id },
      data: {
        assignedToId:    agentId,
        assignedById:    session.user.id,
        assignedAt:      new Date(),
        assignedFromId:  lead.assignedToId  ?? null,
        prevAssignee2Id: lead.assignedById  ?? null,
        lastAssignmentWasFresh: !!resetFeedbacks,
        ...(resetFeedbacks ? { currentFeedbackOptionId: null, currentCycle: { increment: 1 } } : {}),
      },
      include: {
        assignedTo:   { select: { id: true, name: true } },
        assignedBy:   { select: { id: true, name: true } },
        assignedFrom: { select: { id: true, name: true } },
        prevAssignee2:{ select: { id: true, name: true } },
      },
    });
  });

  await logActivity({
    userId: session.user.id,
    action: 'LEAD_ASSIGNED',
    targetId: params.id,
    targetType: 'Lead',
    description: resetFeedbacks
      ? `Lead ${params.id} reassigned to ${updated.assignedTo?.name ?? agentId} as a fresh lead (previous feedback archived)`
      : `Lead ${params.id} reassigned to ${updated.assignedTo?.name ?? agentId}`,
    metadata: { agentId, fresh: !!resetFeedbacks },
  }).catch((err) => console.error('[assign] activity log failed:', err));

  // Notify the assigned agent — non-blocking so a DB hiccup here
  // doesn't make the entire assign appear to have failed
  prisma.notification.create({
    data: {
      userId: agentId,
      type:   'LEAD_ASSIGNED',
      title:  'New Lead Assigned',
      body:   `${updated.name} has been assigned to you by ${updated.assignedBy?.name ?? 'your TL'}.`,
      leadId: params.id,
    },
  }).catch((err) => console.error('[assign] notification create failed:', err));

  return NextResponse.json(updated);
  } catch (error) {
    console.error('[leads/[id]/assign POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
