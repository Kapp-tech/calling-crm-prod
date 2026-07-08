import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { BreakType } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAttendanceDateString, summarizeAttendance } from '@/lib/attendance';

const PUNCH_ROLES = ['COUNSELLING_AGENT', 'COUNSELLING_TL'];

const bodySchema = z.object({ type: z.nativeEnum(BreakType) });

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !PUNCH_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Select a break type — Lunch, Bio, or Tea' }, { status: 400 });
    }

    const date = getAttendanceDateString();
    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId: session.user.id, date } },
      include: { breaks: true },
    });

    if (!existing || existing.punchOutAt) {
      return NextResponse.json({ error: 'You must be punched in to start a break' }, { status: 409 });
    }
    if (existing.breaks.some((b) => !b.endAt)) {
      return NextResponse.json({ error: 'You are already on a break' }, { status: 409 });
    }

    const now = new Date();
    await prisma.attendanceBreak.create({ data: { attendanceId: existing.id, startAt: now, type: parsed.data.type } });
    const updated = await prisma.attendance.update({
      where: { id: existing.id },
      data: { lastHeartbeatAt: now },
      include: { breaks: true },
    });

    return NextResponse.json(summarizeAttendance(updated));
  } catch (error) {
    console.error('[attendance/break/start POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
