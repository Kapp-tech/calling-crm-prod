import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { canAccessLead } from '@/lib/lead-access';
import { Feature } from '@prisma/client';

const reviewSchema = z
  .object({
    action: z.enum(['APPROVE', 'DISAPPROVE']),
    reason: z.string().trim().max(1000).optional(),
  })
  .refine((d) => d.action !== 'DISAPPROVE' || !!d.reason?.trim(), {
    message: 'A reason is required to disapprove a receipt',
    path: ['reason'],
  });

// Approve or disapprove a single uploaded receipt. Approving flips the
// lead's matching Primary App./Adm. Confirm field to "Yes"; disapproving
// requires a reason and leaves the door open for the agent to upload a
// fresh receipt of the same type (a plain new POST — no special "resend"
// endpoint needed, the upload route already allows re-uploading).
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; receiptId: string } }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(await hasPermission(session.user.role, Feature.APPROVE_RECEIPTS))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const body = await req.json().catch(() => null);
    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    const { action, reason } = parsed.data;

    const receipt = await prisma.leadReceipt.findFirst({
      where: { id: params.receiptId, leadId: params.id },
    });
    if (!receipt) return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
    if (receipt.status !== 'PENDING') {
      return NextResponse.json({ error: 'This receipt has already been reviewed' }, { status: 409 });
    }

    const now = new Date();
    const trimmedReason = action === 'DISAPPROVE' ? reason!.trim() : null;

    const updated = await prisma.$transaction(async (tx) => {
      const r = await tx.leadReceipt.update({
        where: { id: receipt.id },
        data: {
          status: action === 'APPROVE' ? 'APPROVED' : 'DISAPPROVED',
          reviewedById: session.user.id,
          reviewedAt: now,
          disapprovalReason: trimmedReason,
        },
      });

      if (action === 'APPROVE') {
        await tx.lead.update({
          where: { id: params.id },
          data:
            receipt.type === 'APPLICATION'
              ? { primaryApplicationConfirm: 'Yes' }
              : { primaryAdmissionConfirm: 'Yes' },
        });
      }

      await logActivity({
        userId: session.user.id,
        action: action === 'APPROVE' ? 'RECEIPT_APPROVED' : 'RECEIPT_DISAPPROVED',
        targetId: receipt.id,
        targetType: 'LeadReceipt',
        description:
          action === 'APPROVE'
            ? `Approved ${receipt.type.toLowerCase()} receipt for ${receipt.studentName} (lead ${params.id})`
            : `Disapproved ${receipt.type.toLowerCase()} receipt for ${receipt.studentName} (lead ${params.id}) — ${trimmedReason}`,
        metadata: { leadId: params.id, receiptId: receipt.id, type: receipt.type },
      });

      return r;
    });

    // Notify the uploading agent — outside the transaction, non-blocking so a
    // notification failure never rolls back the actual approval/disapproval.
    const kindLabel = receipt.type === 'APPLICATION' ? 'Application' : 'Admission';
    prisma.notification
      .create({
        data: {
          userId: receipt.uploadedById,
          type: action === 'APPROVE' ? 'RECEIPT_APPROVED' : 'RECEIPT_DISAPPROVED',
          title: action === 'APPROVE' ? `${kindLabel} receipt approved` : `${kindLabel} receipt needs changes`,
          body:
            action === 'APPROVE'
              ? `Your ${kindLabel.toLowerCase()} receipt for ${receipt.studentName} was approved.`
              : `Your ${kindLabel.toLowerCase()} receipt for ${receipt.studentName} was disapproved: ${trimmedReason}`,
          leadId: params.id,
        },
      })
      .catch((err) => console.error('[receipt review] notification create failed:', err));

    return NextResponse.json(updated);
  } catch (error) {
    console.error('[leads/[id]/receipts/[receiptId] PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
