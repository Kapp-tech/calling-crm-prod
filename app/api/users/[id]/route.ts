import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Role, WorkType } from '@prisma/client';
import { logActivity } from '@/lib/permissions';

// Optional, but must be a real 10-digit number when provided. An empty string
// becomes NULL so clearing the field in the edit form actually clears it —
// whereas omitting the key entirely leaves the stored value untouched.
const phoneField = z
  .string()
  .nullish()
  .transform((v) => {
    const t = (v ?? '').trim();
    return t === '' ? null : t;
  })
  .refine((v) => v === null || /^\d{10}$/.test(v), {
    message: 'Phone must be exactly 10 digits',
  })
  .optional();

const updateUserSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  role: z.nativeEnum(Role).optional(),
  phone: phoneField,
  workType: z.nativeEnum(WorkType).optional(),
  joiningDate: z.coerce.date().optional(),
  isActive: z.boolean().optional(),
  teamId: z.string().nullable().optional(),
  managedById: z.string().nullable().optional(),
  managerId: z.string().nullable().optional(),
  rejectionReason: z.string().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: params.id },
    select: {
      id: true, name: true, email: true, role: true, isActive: true, status: true,
      employeeCode: true, phone: true, joiningDate: true, createdAt: true,
      teamId: true, managerId: true, managedById: true,
      team: { select: { id: true, name: true, teamLeadId: true } },
      manager: { select: { id: true, name: true } },
      _count: { select: { assignedLeads: true, feedbacks: true } },
    },
  });

  if (!user) return NextResponse.json({ success: false, error: 'Not found', code: 'NOT_FOUND' }, { status: 404 });

  // Personal details (phone, employee code, lead counts) are only for:
  // admins, the reports role, the user themselves, or their own TL/manager.
  const viewer = session.user;
  const canView =
    ['SUPER_ADMIN', 'REPORTS'].includes(viewer.role) ||
    user.id === viewer.id ||
    user.managerId === viewer.id ||
    user.managedById === viewer.id ||
    (viewer.role === 'COUNSELLING_TL' && user.team?.teamLeadId === viewer.id);

  if (!canView) {
    return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const { team, ...rest } = user;
  return NextResponse.json({ ...rest, team: team ? { id: team.id, name: team.name } : null });
  } catch (error) {
    console.error('[users/[id] GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const { password, isActive, ...rest } = parsed.data;
  const updateData: Record<string, unknown> = { ...rest };

  if (password) updateData.password = await bcrypt.hash(password, 12);
  if (isActive !== undefined) {
    updateData.isActive = isActive;
    updateData.status = isActive ? 'ACTIVE' : 'INACTIVE';
  }

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: params.id },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, isActive: true, status: true, updatedAt: true },
    });

    const action = isActive === false ? 'USER_DEACTIVATED' : 'USER_UPDATED';
    await logActivity({
      userId: session.user.id,
      action,
      targetId: params.id,
      targetType: 'User',
      description: `${action.replace('_', ' ').toLowerCase()} for user "${u.name}"`,
    });

    return u;
  });

  return NextResponse.json(user);
  } catch (error) {
    console.error('[users/[id] PATCH]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    await prisma.user.update({ where: { id: params.id }, data: { isActive: false, status: 'INACTIVE' } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[users/[id] DELETE]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
