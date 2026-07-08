import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Role, UserStatus } from '@prisma/client';
import { generateEmployeeCode, logActivity } from '@/lib/permissions';

const userRowSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
  role: z.nativeEnum(Role),
  team_name: z.string().optional(),
  group_name: z.string().optional(),
});

const bulkSchema = z.object({
  users: z.array(userRowSchema).min(1).max(200),
});

export async function POST(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = bulkSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const defaultHash = await bcrypt.hash('Password@123', 12);
  const results: { email: string; status: 'created' | 'skipped'; employeeCode?: string; reason?: string }[] = [];

  for (const row of parsed.data.users) {
    const existing = await prisma.user.findUnique({ where: { email: row.email } });
    if (existing) {
      results.push({ email: row.email, status: 'skipped', reason: 'Email already exists' });
      continue;
    }

    let teamId: string | undefined;
    let opsGroupId: string | undefined;

    if (row.team_name && row.role === Role.COUNSELLING_AGENT) {
      const team = await prisma.team.findFirst({ where: { name: { contains: row.team_name, mode: 'insensitive' } } });
      if (team) teamId = team.id;
    }
    if (row.group_name && row.role === Role.OPERATIONS) {
      const grp = await prisma.operationsGroup.findFirst({ where: { name: { contains: row.group_name, mode: 'insensitive' } } });
      if (grp) opsGroupId = grp.id;
    }

    const employeeCode = await generateEmployeeCode();

    await prisma.user.create({
      data: {
        name: row.name,
        email: row.email,
        phone: row.phone,
        password: defaultHash,
        role: row.role,
        status: UserStatus.ACTIVE,
        isActive: true,
        employeeCode,
        joiningDate: new Date(),
        ...(teamId ? { teamId } : {}),
        ...(opsGroupId ? { operationsGroupId: opsGroupId } : {}),
      },
    });

    results.push({ email: row.email, status: 'created', employeeCode });
  }

  await logActivity({
    userId: session.user.id,
    action: 'USER_CREATED',
    description: `Bulk imported ${results.filter((r) => r.status === 'created').length} users`,
    metadata: { total: parsed.data.users.length, created: results.filter((r) => r.status === 'created').length },
  });

  return NextResponse.json({ success: true, results });
  } catch (error) {
    console.error('[users/bulk-import POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
