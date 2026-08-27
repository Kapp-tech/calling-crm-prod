import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';
import { PRIORITY_SETTING_ID, eligibleAgents, loadPriorityRule } from '@/lib/priority-assignment';

/**
 * Configurations → Priority Settings.
 *
 * Super Admin only and PIN-gated: this quietly redirects incoming leads to a
 * chosen set of agents, and nobody outside this screen can see that it is on.
 */

async function guard(action: 'read' | 'write') {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  // Reading is gated too — the page shows exactly which agents are receiving
  // leads, which is the sensitive part.
  if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.PRIORITY_ASSIGNMENT))) {
    return { error: NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 }) };
  }
  return { session };
}

export async function GET() {
  const g = await guard('read');
  if (g.error) return g.error;

  try {
    const [row, rule, callingTypes, agents] = await Promise.all([
      prisma.priorityAssignmentSetting.findUnique({
        where: { id: PRIORITY_SETTING_ID },
        include: { updatedBy: { select: { name: true } } },
      }),
      loadPriorityRule(prisma),
      prisma.dropdownOption.findMany({
        where: { type: 'DATA_CALLING_TYPE', isActive: true },
        select: { value: true },
        orderBy: { value: 'asc' },
      }),
      prisma.user.findMany({
        where: { role: 'COUNSELLING_AGENT', isActive: true },
        select: { id: true, name: true, employeeCode: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    // Which of the saved agents would actually receive a lead right now. A
    // configured agent who has since been deactivated silently stops being in
    // the rotation, so the page says so rather than implying they are still in.
    const live = await eligibleAgents(prisma, rule);

    return NextResponse.json({
      setting: {
        isEnabled: row?.isEnabled ?? false,
        dataCallingTypes: row?.dataCallingTypes ?? [],
        agentIds: row?.agentIds ?? [],
        assignedCount: row?.assignedCount ?? 0,
        lastAssignedAt: row?.lastAssignedAt ?? null,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy?.name ?? null,
      },
      choices: { dataCallingTypes: callingTypes.map((c) => c.value), agents },
      activeAgentCount: live.length,
    });
  } catch (err) {
    console.error('[priority-assignment GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const bodySchema = z.object({
  isEnabled: z.boolean(),
  dataCallingTypes: z.array(z.string().trim().min(1)).max(50),
  agentIds: z.array(z.string().min(1)).max(500),
});

export async function PUT(req: NextRequest) {
  const g = await guard('write');
  if (g.error) return g.error;

  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { isEnabled, dataCallingTypes, agentIds } = parsed.data;

  // Turning it on with nothing selected would look enabled and do nothing —
  // the worst kind of setting. Refused with the reason rather than saved.
  if (isEnabled && dataCallingTypes.length === 0) {
    return NextResponse.json({ error: 'Choose at least one Data Calling Type, or turn auto-assign off.' }, { status: 400 });
  }
  if (isEnabled && agentIds.length === 0) {
    return NextResponse.json({ error: 'Choose at least one agent, or turn auto-assign off.' }, { status: 400 });
  }

  try {
    // Only real, active agents are stored: saving an id that cannot receive a
    // lead would show a rotation that is not the rotation.
    const valid = agentIds.length
      ? (await prisma.user.findMany({
          where: { id: { in: agentIds }, role: 'COUNSELLING_AGENT', isActive: true },
          select: { id: true },
        })).map((u) => u.id)
      : [];

    if (isEnabled && valid.length === 0) {
      return NextResponse.json({ error: 'None of those agents are active counselling agents.' }, { status: 400 });
    }

    const allowed = new Set(
      (await prisma.dropdownOption.findMany({
        where: { type: 'DATA_CALLING_TYPE', isActive: true },
        select: { value: true },
      })).map((c) => c.value.trim().toLowerCase()),
    );
    const unknown = dataCallingTypes.filter((t) => !allowed.has(t.trim().toLowerCase()));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Not an active Data Calling Type: ${unknown.join(', ')}` },
        { status: 400 },
      );
    }

    const saved = await prisma.priorityAssignmentSetting.upsert({
      where: { id: PRIORITY_SETTING_ID },
      create: { id: PRIORITY_SETTING_ID, isEnabled, dataCallingTypes, agentIds: valid, updatedById: g.session!.user.id },
      // cursor is deliberately not reset: editing the agent list should carry
      // on from where the rotation was, not hand the next several leads to
      // whoever happens to sort first.
      update: { isEnabled, dataCallingTypes, agentIds: valid, updatedById: g.session!.user.id },
    });

    await logActivity({
      userId: g.session!.user.id,
      action: 'PERMISSION_CHANGED',
      targetType: 'PriorityAssignmentSetting',
      targetId: saved.id,
      description: isEnabled
        ? `Priority auto-assign ON for ${dataCallingTypes.join(', ')} across ${valid.length} agent(s)`
        : 'Priority auto-assign turned OFF',
    });

    return NextResponse.json({ success: true, droppedAgents: agentIds.length - valid.length });
  } catch (err) {
    console.error('[priority-assignment PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
