import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { generateEmployeeCode, logActivity } from '@/lib/permissions';
import { UserStatus } from '@prisma/client';

const requestAgentSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  phone: z.string().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) return NextResponse.json({ success: false, error: 'Team not found', code: 'NOT_FOUND' }, { status: 404 });

  if (session.user.role === 'COUNSELLING_TL' && team.teamLeadId !== session.user.id) {
    return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const agentSelect = {
    id: true, name: true, email: true, phone: true, employeeCode: true,
    status: true, isActive: true, joiningDate: true,
    _count: { select: { assignedLeads: true, feedbacks: true } },
  } as const;

  // Fetch via teamId AND via managedById (covers agents created before teamId was auto-set)
  const [byTeam, byTL] = await Promise.all([
    prisma.user.findMany({ where: { teamId: params.id, role: 'COUNSELLING_AGENT' }, select: agentSelect }),
    team.teamLeadId
      ? prisma.user.findMany({
          where: { managedById: team.teamLeadId, role: 'COUNSELLING_AGENT', teamId: { not: params.id } },
          select: agentSelect,
        })
      : Promise.resolve([]),
  ]);

  const agents = [...byTeam, ...byTL].sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json(agents);
  } catch (error) {
    console.error('[teams/[id]/agents GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

// TL requests a new agent (status = PENDING_APPROVAL); SA creates directly (status = ACTIVE)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || !['SUPER_ADMIN', 'COUNSELLING_TL'].includes(session.user.role)) {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const team = await prisma.team.findUnique({ where: { id: params.id } });
  if (!team) return NextResponse.json({ success: false, error: 'Team not found', code: 'NOT_FOUND' }, { status: 404 });

  if (session.user.role === 'COUNSELLING_TL' && team.teamLeadId !== session.user.id) {
    return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const body = await req.json();
  const parsed = requestAgentSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const { name, email, phone } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return NextResponse.json({ success: false, error: 'Email already in use', code: 'DUPLICATE_EMAIL' }, { status: 409 });

  const isSA = session.user.role === 'SUPER_ADMIN';
  const tempPassword = isSA ? 'Password@123' : Math.random().toString(36).slice(-8);
  const hashed = await bcrypt.hash(tempPassword, 12);
  const employeeCode = await generateEmployeeCode();

  const agent = await prisma.$transaction(async (tx) => {
    const u = await tx.user.create({
      data: {
        name,
        email,
        phone,
        password: hashed,
        role: 'COUNSELLING_AGENT',
        status: isSA ? UserStatus.ACTIVE : UserStatus.PENDING_APPROVAL,
        isActive: isSA,
        employeeCode,
        teamId: params.id,
        managerId: team.teamLeadId ?? undefined,
        managedById: team.teamLeadId ?? undefined,
      },
      select: { id: true, name: true, email: true, employeeCode: true, status: true },
    });
    await logActivity({
      userId: session.user.id,
      action: 'USER_CREATED',
      targetId: u.id,
      targetType: 'User',
      description: isSA
        ? `SA created agent "${name}" in team "${team.name}"`
        : `TL requested new agent "${name}" for team "${team.name}" — pending approval`,
    });
    return u;
  });

  return NextResponse.json({ ...agent, tempPassword: isSA ? tempPassword : undefined }, { status: 201 });
  } catch (error) {
    console.error('[teams/[id]/agents POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
