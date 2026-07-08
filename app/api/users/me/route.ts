import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';

export async function GET() {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true, name: true, email: true, role: true, employeeCode: true,
      phone: true, joiningDate: true, createdAt: true, status: true, isActive: true, workType: true,
      team: { select: { id: true, name: true } },
      operationsGroup: { select: { id: true, name: true } },
      manager: { select: { id: true, name: true, role: true } },
    },
  });

  if (!user) return NextResponse.json({ success: false, error: 'User not found', code: 'NOT_FOUND' }, { status: 404 });
  return NextResponse.json(user);
  } catch (error) {
    console.error('[users/me GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

const updateSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').optional(),
  phone: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const updated = await prisma.user.update({
    where: { id: session.user.id },
    data: parsed.data,
    select: { id: true, name: true, phone: true },
  });

  await logActivity({
    userId: session.user.id,
    action: 'USER_UPDATED',
    targetId: session.user.id,
    targetType: 'User',
    description: 'User updated their own profile',
  });

  return NextResponse.json({ success: true, user: updated });
  } catch (error) {
    console.error('[users/me PATCH]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
