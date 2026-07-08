import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';

const schema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .regex(/[A-Z]/, 'New password must contain at least one uppercase letter')
    .regex(/[0-9]/, 'New password must contain at least one number'),
  confirmPassword: z.string().min(1, 'Please confirm your new password'),
});

export async function PATCH(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const firstError = parsed.error.errors[0]?.message ?? 'Validation error';
    return NextResponse.json({ success: false, error: firstError, code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const { currentPassword, newPassword, confirmPassword } = parsed.data;

  // 1. Passwords must match
  if (newPassword !== confirmPassword) {
    return NextResponse.json({ success: false, error: 'Passwords do not match', code: 'PASSWORD_MISMATCH' }, { status: 400 });
  }

  // 2. Fetch user's current hashed password
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { password: true } });
  if (!user) return NextResponse.json({ success: false, error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });

  // 3. Verify current password
  const isValid = await bcrypt.compare(currentPassword, user.password);
  if (!isValid) {
    return NextResponse.json({ success: false, error: 'Current password is incorrect', code: 'WRONG_PASSWORD' }, { status: 400 });
  }

  // 4. New password must differ from current
  const isSame = await bcrypt.compare(newPassword, user.password);
  if (isSame) {
    return NextResponse.json({ success: false, error: 'New password must be different from current password', code: 'SAME_PASSWORD' }, { status: 400 });
  }

  // 5. Hash and save new password
  const hashed = await bcrypt.hash(newPassword, 12);
  await prisma.user.update({ where: { id: session.user.id }, data: { password: hashed } });

  // 6. Log the action
  await logActivity({
    userId: session.user.id,
    action: 'PASSWORD_CHANGED',
    targetId: session.user.id,
    targetType: 'User',
    description: 'User changed their own password',
  });

  // 7. Session stays valid — do NOT invalidate it
  return NextResponse.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    console.error('[users/me/change-password PATCH]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
