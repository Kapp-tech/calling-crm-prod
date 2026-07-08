import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { Feature } from '@prisma/client';

const schema = z.object({
  reason: z.string().min(1, 'A reason is required for batch disapproval'),
});

export async function PATCH(req: NextRequest, { params }: { params: { batchId: string } }) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const canApprove = await hasPermission(session.user.role, Feature.APPROVE_LEADS);
  if (!canApprove) return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const { reason } = parsed.data;
  const now = new Date();

  // Only disapprove PENDING leads in the batch — don't touch already-approved ones
  const { count } = await prisma.$transaction(async (tx) => {
    const result = await tx.lead.updateMany({
      where: { batchId: params.batchId, status: 'PENDING' },
      data: {
        status: 'DISAPPROVED',
        disapprovedById: session.user.id,
        disapprovedAt: now,
        disapprovalReason: reason,
      },
    });

    await logActivity({
      userId: session.user.id,
      action: 'BATCH_DISAPPROVED',
      targetId: params.batchId,
      targetType: 'UploadBatch',
      description: `Batch disapproved ${result.count} leads — reason: ${reason}`,
      metadata: { batchId: params.batchId, count: result.count, reason },
    });

    return result;
  });

  return NextResponse.json({ success: true, disapproved: count });
  } catch (error) {
    console.error('[leads/batch/disapprove PATCH]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
