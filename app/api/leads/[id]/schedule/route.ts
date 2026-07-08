import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';

const scheduleSchema = z.object({
  scheduledAt: z.string().min(1),
  note: z.string().max(500).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const schedules = await prisma.scheduledCall.findMany({
      where: { leadId: params.id, agentId: session.user.id },
      orderBy: { scheduledAt: 'desc' },
      include: { agent: { select: { name: true } } },
    });
    return NextResponse.json(schedules);
  } catch (err) {
    console.error('[schedule GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const parsed = scheduleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const scheduledDate = new Date(parsed.data.scheduledAt);
  if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
    return NextResponse.json({ error: 'Scheduled time must be in the future' }, { status: 400 });
  }

  try {
    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    await prisma.scheduledCall.updateMany({
      where: { leadId: params.id, agentId: session.user.id, status: 'PENDING' },
      data:  { status: 'CANCELLED' },
    });

    const schedule = await prisma.scheduledCall.create({
      data: {
        leadId:      params.id,
        agentId:     session.user.id,
        scheduledAt: scheduledDate,
        note:        parsed.data.note ?? null,
        status:      'PENDING',
      },
    });
    return NextResponse.json(schedule, { status: 201 });
  } catch (err) {
    console.error('[schedule POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { scheduleId, status } = await req.json();
  if (!scheduleId || !['DONE', 'CANCELLED'].includes(status)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  }

  try {
    const updated = await prisma.scheduledCall.updateMany({
      where: { id: scheduleId, leadId: params.id, agentId: session.user.id },
      data:  { status },
    });
    return NextResponse.json({ success: updated.count > 0 });
  } catch (err) {
    console.error('[schedule PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
