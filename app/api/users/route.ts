import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Role, UserStatus, WorkType } from '@prisma/client';
import { generateEmployeeCode, logActivity } from '@/lib/permissions';
import { sendWelcomeEmail } from '@/lib/welcome-email';

// Optional, but must be a real 10-digit number when provided. An empty string
// stores NULL rather than "". Matches the referral form's existing rule in
// /api/leads/[id]/referrals.
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

const createUserSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.nativeEnum(Role),
  workType: z.nativeEnum(WorkType).optional(),
  phone: phoneField,
  teamId: z.string().optional().nullable(),
  operationsGroupId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  managedById: z.string().optional().nullable(),
  joiningDate: z.coerce.date().optional(),
  // DialShree dialer seat. Trimmed to null when blank so the unique index
  // does not treat several empty strings as a collision.
  dialshreeId: z.string().trim().max(64).optional().nullable(),
  // Reporting attributes — see the notes on the fields in schema.prisma.
  zone:     z.string().trim().max(40).optional().nullable(),
  language: z.string().trim().max(80).optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const role = searchParams.get('role') as Role | null;
  const tlId = searchParams.get('tlId');
  const teamId = searchParams.get('teamId');
  const status = searchParams.get('status') as UserStatus | null;

  // COUNSELLING_TL: can only fetch agents that are under their management
  if (session.user.role === Role.COUNSELLING_TL) {
    const agents = await prisma.user.findMany({
      where: {
        role: Role.COUNSELLING_AGENT,
        isActive: true,
        OR: [
          { managedById: session.user.id },
          { team: { teamLeadId: session.user.id } },
        ],
      },
      select: {
        id: true, name: true, email: true, role: true, workType: true, isActive: true, status: true,
        employeeCode: true, phone: true, teamId: true, managedById: true,
        _count: { select: { assignedLeads: true } },
      },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(agents);
  }

  // REPORTS is read-only but needs this list for TL/agent filter dropdowns
  // on the dashboard and All Leads pages — same query path as SUPER_ADMIN.
  // All other non-SA roles: forbidden.
  if (session.user.role !== Role.SUPER_ADMIN && session.user.role !== Role.REPORTS) {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const users = await prisma.user.findMany({
    where: {
      ...(role ? { role } : {}),
      ...(tlId ? { managedById: tlId } : {}),
      ...(teamId ? { teamId } : {}),
      ...(status ? { status } : {}),
    },
    select: {
      id: true, name: true, email: true, role: true, workType: true, isActive: true, status: true,
      employeeCode: true, phone: true, joiningDate: true, createdAt: true, dialshreeId: true, zone: true, language: true,
      managedById: true, managerId: true, teamId: true, operationsGroupId: true,
      managedBy: { select: { id: true, name: true } },
      team: { select: { id: true, name: true } },
      operationsGroup: { select: { id: true, name: true } },
      _count: { select: { assignedLeads: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(users);
  } catch (error) {
    console.error('[users GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const { password, ...data } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return NextResponse.json({ success: false, error: 'Email already in use', code: 'DUPLICATE_EMAIL' }, { status: 409 });

  const hashed = await bcrypt.hash(password, 12);
  const employeeCode = await generateEmployeeCode();

  // An agent's "manager" is the TL they're assigned to, unless a different
  // reporting manager was explicitly picked in the form.
  const managerId = data.managerId ?? (data.role === Role.COUNSELLING_AGENT ? data.managedById : undefined);

  const user = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        ...data,
        // Blank input must land as NULL: `dialshreeId` is unique, and several
        // users saved with '' would collide on the second one.
        dialshreeId: data.dialshreeId?.trim() || null,
        zone:     data.zone?.trim() || null,
        language: data.language?.trim() || null,
        managerId,
        password: hashed,
        employeeCode,
        status: UserStatus.ACTIVE,
        isActive: true,
        joiningDate: data.joiningDate ?? new Date(),
      },
      select: {
        id: true, name: true, email: true, role: true, employeeCode: true,
        isActive: true, status: true, createdAt: true,
      },
    });

    // Auto-create team for a new TL if no teamId provided
    if (data.role === Role.COUNSELLING_TL && !data.teamId) {
      const team = await tx.team.create({
        data: {
          name: `${data.name}'s Team`,
          teamLeadId: u.id,
          createdById: session.user.id,
        },
      });
      await tx.user.update({ where: { id: u.id }, data: { teamId: team.id } });
    }

    // When creating an agent under a TL, auto-set teamId from TL's team
    if (data.role === Role.COUNSELLING_AGENT && data.managedById && !data.teamId) {
      const tlUser = await tx.user.findUnique({
        where: { id: data.managedById },
        select: { teamId: true },
      });
      if (tlUser?.teamId) {
        await tx.user.update({ where: { id: u.id }, data: { teamId: tlUser.teamId } });
      }
    }

    await logActivity({
      userId: session.user.id,
      action: 'USER_CREATED',
      targetId: u.id,
      targetType: 'User',
      description: `Created user "${data.name}" with role ${data.role}`,
    });

    return u;
  });

  // Welcome the new joiner. Deliberately outside the transaction and never
  // awaited for its result: a mail provider having a bad minute must not roll
  // back a created account or leave the admin staring at a spinner. Failures
  // land in EmailLog, where they can be seen and re-sent.
  void sendWelcomeEmail({
    name: user.name,
    employeeCode: user.employeeCode,
    email: user.email,
    // The only moment the plaintext exists — it is bcrypt-hashed in the row.
    password,
  });

  return NextResponse.json({ ...user, tempPassword: password }, { status: 201 });
  } catch (error) {
    // A clashing dialer seat is an admin mistake to correct, not a server
    // fault — name the field so they know what to change.
    if (
      typeof error === 'object' && error !== null &&
      (error as { code?: string }).code === 'P2002' &&
      String((error as { meta?: { target?: unknown } }).meta?.target ?? '').includes('dialshreeId')
    ) {
      return NextResponse.json(
        { success: false, error: 'That DialShree ID is already mapped to another user.', code: 'DUPLICATE_DIALSHREE_ID' },
        { status: 409 }
      );
    }
    console.error('[users POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
