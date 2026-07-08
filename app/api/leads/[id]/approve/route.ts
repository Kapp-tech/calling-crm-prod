import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { Feature } from '@prisma/client';

const approveSchema = z.object({
  action: z.enum(['APPROVE', 'DISAPPROVE']),
  reason: z.string().optional(), // required for DISAPPROVE, validated below
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const canApprove = await hasPermission(session.user.role, Feature.APPROVE_LEADS);
  if (!canApprove) return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

  const body = await req.json();
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const { action, reason } = parsed.data;

  if (action === 'DISAPPROVE' && !reason?.trim()) {
    return NextResponse.json({ success: false, error: 'A reason is required when disapproving a lead', code: 'REASON_REQUIRED' }, { status: 400 });
  }

  const lead = await prisma.lead.findUnique({ where: { id: params.id } });
  if (!lead) return NextResponse.json({ success: false, error: 'Lead not found', code: 'NOT_FOUND' }, { status: 404 });

  const now = new Date();
  const isApprove = action === 'APPROVE';

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.lead.update({
      where: { id: params.id },
      data: isApprove
        ? { status: 'APPROVED', approvedById: session.user.id, approvedAt: now }
        : {
            status: 'DISAPPROVED',
            disapprovedById: session.user.id,
            disapprovedAt: now,
            disapprovalReason: reason,
          },
      select: {
        id: true, status: true, name: true,
        approvedBy: { select: { name: true } },
        disapprovedBy: { select: { name: true } },
        approvedAt: true, disapprovedAt: true, disapprovalReason: true,
      },
    });

    await logActivity({
      userId: session.user.id,
      action: isApprove ? 'LEAD_APPROVED' : 'LEAD_DISAPPROVED',
      targetId: params.id,
      targetType: 'Lead',
      description: isApprove
        ? `Approved lead "${lead.name}"`
        : `Disapproved lead "${lead.name}" — reason: ${reason}`,
    });

    return u;
  });

  return NextResponse.json({ success: true, lead: updated });
}
