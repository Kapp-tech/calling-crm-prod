import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';

const transferSchema = z.object({
  targetTeamId: z.string().min(1),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; agentId: string } }
) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = transferSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

  const { targetTeamId } = parsed.data;

  const [agent, targetTeam] = await Promise.all([
    prisma.user.findUnique({ where: { id: params.agentId } }),
    prisma.team.findUnique({ where: { id: targetTeamId } }),
  ]);

  if (!agent) return NextResponse.json({ success: false, error: 'Agent not found', code: 'NOT_FOUND' }, { status: 404 });
  if (!targetTeam) return NextResponse.json({ success: false, error: 'Target team not found', code: 'NOT_FOUND' }, { status: 404 });

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: params.agentId },
      data: {
        teamId: targetTeamId,
        managerId: targetTeam.teamLeadId ?? undefined,
        managedById: targetTeam.teamLeadId ?? undefined,
      },
    });
    await logActivity({
      userId: session.user.id,
      action: 'AGENT_TRANSFER',
      targetId: params.agentId,
      targetType: 'User',
      description: `Transferred agent "${agent.name}" from team ${params.id} to team "${targetTeam.name}"`,
      metadata: { fromTeamId: params.id, toTeamId: targetTeamId },
    });
    return u;
  });

  return NextResponse.json({ success: true, agent: updated });
  } catch (error) {
    console.error('[teams/agents/transfer PATCH]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
