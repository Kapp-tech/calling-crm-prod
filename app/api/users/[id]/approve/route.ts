import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { UserStatus } from '@prisma/client';

const DEFAULT_PASSWORD = 'Password@123';

const approveSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = approveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) return NextResponse.json({ success: false, error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });
  if (target.status !== UserStatus.PENDING_APPROVAL) {
    return NextResponse.json({ success: false, error: 'User is not pending approval', code: 'INVALID_STATUS' }, { status: 400 });
  }

  const { action, reason } = parsed.data;
  const isApprove = action === 'APPROVE';

  const hashedPassword = isApprove ? await bcrypt.hash(DEFAULT_PASSWORD, 12) : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: params.id },
      data: {
        status: isApprove ? UserStatus.ACTIVE : UserStatus.INACTIVE,
        isActive: isApprove,
        ...(hashedPassword ? { password: hashedPassword } : {}),
        ...(reason ? { rejectionReason: reason } : {}),
      },
      select: { id: true, name: true, email: true, employeeCode: true, status: true },
    });
    await logActivity({
      userId: session.user.id,
      action: isApprove ? 'USER_APPROVED' : 'USER_REJECTED',
      targetId: params.id,
      targetType: 'User',
      description: isApprove
        ? `Approved agent "${target.name}"`
        : `Rejected agent "${target.name}" — reason: ${reason ?? 'N/A'}`,
    });
    return u;
  });

  return NextResponse.json({
    success: true,
    user: updated,
    ...(isApprove ? { tempPassword: DEFAULT_PASSWORD } : {}),
  });
  } catch (error) {
    console.error('[users/[id]/approve POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
