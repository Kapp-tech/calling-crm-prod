import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';

const createTeamSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  teamLeadId: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const myTeam = searchParams.get('myTeam') === 'true';

  // TL: only see their own team
  const where =
    session.user.role === 'COUNSELLING_TL' || myTeam
      ? { teamLeadId: session.user.id }
      : session.user.role === 'SUPER_ADMIN'
      ? {}
      : { teamLeadId: session.user.id };

  const teams = await prisma.team.findMany({
    where,
    include: {
      teamLead: { select: { id: true, name: true, email: true, employeeCode: true } },
      _count: { select: { members: true, leads: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(teams);
  } catch (error) {
    console.error('[teams GET]', error);
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
  const parsed = createTeamSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const { name, description, teamLeadId } = parsed.data;

  const team = await prisma.$transaction(async (tx) => {
    const t = await tx.team.create({
      data: { name, description, teamLeadId: teamLeadId ?? null, createdById: session.user.id },
    });
    // Link TL to this team
    if (teamLeadId) {
      await tx.user.update({ where: { id: teamLeadId }, data: { teamId: t.id } });
    }
    await logActivity({ userId: session.user.id, action: 'TEAM_CREATED', targetId: t.id, targetType: 'Team', description: `Created team "${name}"` });
    return t;
  });

  return NextResponse.json(team, { status: 201 });
  } catch (error) {
    console.error('[teams POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
