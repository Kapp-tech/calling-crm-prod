import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAttendanceDateString, summarizeAttendance, MAX_HEARTBEAT_WINDOW_SECONDS } from '@/lib/attendance';

const PUNCH_ROLES = ['COUNSELLING_AGENT', 'COUNSELLING_TL'];

const schema = z.object({
  activeDeltaSeconds: z.number().min(0).max(MAX_HEARTBEAT_WINDOW_SECONDS),
  idleDeltaSeconds: z.number().min(0).max(MAX_HEARTBEAT_WINDOW_SECONDS),
}).refine((d) => d.activeDeltaSeconds + d.idleDeltaSeconds <= MAX_HEARTBEAT_WINDOW_SECONDS, {
  message: 'Combined active + idle delta exceeds the allowed window',
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !PUNCH_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const date = getAttendanceDateString();
    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId: session.user.id, date } },
      include: { breaks: true },
    });

    // Only accrue time while actually on the clock and not on a break.
    if (!existing || existing.punchOutAt || existing.breaks.some((b) => !b.endAt)) {
      return NextResponse.json({ error: 'No active working shift' }, { status: 409 });
    }

    const now = new Date();
    const updated = await prisma.attendance.update({
      where: { id: existing.id },
      data: {
        activeSeconds: { increment: Math.round(parsed.data.activeDeltaSeconds) },
        idleSeconds: { increment: Math.round(parsed.data.idleDeltaSeconds) },
        lastHeartbeatAt: now,
      },
      include: { breaks: true },
    });

    return NextResponse.json(summarizeAttendance(updated));
  } catch (error) {
    console.error('[attendance/heartbeat POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
