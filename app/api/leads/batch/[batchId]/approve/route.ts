import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { validateLeadForApproval } from '@/lib/lead-access';
import { Feature } from '@prisma/client';

export async function PATCH(req: NextRequest, { params }: { params: { batchId: string } }) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const canApprove = await hasPermission(session.user.role, Feature.APPROVE_LEADS);
  if (!canApprove) return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

  // Fetch all PENDING leads in this batch
  const leads = await prisma.lead.findMany({
    where: { batchId: params.batchId, status: 'PENDING' },
    select: { id: true, name: true, email: true, phone: true, course: true },
  });

  if (leads.length === 0) {
    return NextResponse.json({ success: false, error: 'No pending leads found in this batch', code: 'NOT_FOUND' }, { status: 404 });
  }

  // Validate each lead — separate valid from invalid
  const valid: string[] = [];
  const invalid: { id: string; name: string; reason: string }[] = [];

  for (const lead of leads) {
    const err = validateLeadForApproval(lead);
    if (err) {
      invalid.push({ id: lead.id, name: lead.name, reason: err });
    } else {
      valid.push(lead.id);
    }
  }

  const now = new Date();

  // Atomically approve all valid leads
  await prisma.$transaction(async (tx) => {
    if (valid.length > 0) {
      await tx.lead.updateMany({
        where: { id: { in: valid } },
        data: { status: 'APPROVED', approvedById: session.user.id, approvedAt: now },
      });
    }

    await logActivity({
      userId: session.user.id,
      action: 'BATCH_APPROVED',
      targetId: params.batchId,
      targetType: 'UploadBatch',
      description: `Batch approved ${valid.length} leads (${invalid.length} skipped due to validation)`,
      metadata: { batchId: params.batchId, approvedCount: valid.length, skippedCount: invalid.length },
    });
  });

  return NextResponse.json({
    success: true,
    approved: valid.length,
    skipped: invalid.length,
    invalidLeads: invalid,
  });
  } catch (error) {
    console.error('[leads/batch/approve PATCH]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
