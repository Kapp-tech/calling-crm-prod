import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature } from '@prisma/client';

const bulkApproveSchema = z.object({
  action: z.enum(['APPROVE', 'DISAPPROVE', 'DELETE']),
  leadIds: z.array(z.string()).min(1),
});

export async function POST(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = bulkApproveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { action, leadIds } = parsed.data;

  if (action === 'APPROVE' || action === 'DISAPPROVE') {
    const canApprove = await hasPermission(session.user.role, Feature.APPROVE_LEADS);
    if (!canApprove) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const newStatus = action === 'APPROVE' ? 'APPROVED' : 'DISAPPROVED';
    await prisma.lead.updateMany({
      where: { id: { in: leadIds } },
      data: { status: newStatus, approvedById: session.user.id },
    });

    return NextResponse.json({ updated: leadIds.length });
  }

  if (action === 'DELETE') {
    if (!['SUPER_ADMIN', 'REPORTS'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const where =
      session.user.role === 'SUPER_ADMIN'
        ? { id: { in: leadIds } }
        : { id: { in: leadIds }, status: 'DISAPPROVED' as const };

    await prisma.lead.deleteMany({ where });
    return NextResponse.json({ deleted: leadIds.length });
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('[leads/bulk POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
