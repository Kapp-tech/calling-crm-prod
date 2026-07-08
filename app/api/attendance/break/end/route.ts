import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAttendanceDateString, summarizeAttendance } from '@/lib/attendance';

const PUNCH_ROLES = ['COUNSELLING_AGENT', 'COUNSELLING_TL'];

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !PUNCH_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const date = getAttendanceDateString();
    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId: session.user.id, date } },
      include: { breaks: true },
    });

    const openBreak = existing?.breaks.find((b) => !b.endAt);
    if (!existing || existing.punchOutAt || !openBreak) {
      return NextResponse.json({ error: 'You are not currently on a break' }, { status: 409 });
    }

    const now = new Date();
    await prisma.attendanceBreak.update({ where: { id: openBreak.id }, data: { endAt: now } });
    const updated = await prisma.attendance.update({
      where: { id: existing.id },
      data: { lastHeartbeatAt: now },
      include: { breaks: true },
    });

    return NextResponse.json(summarizeAttendance(updated));
  } catch (error) {
    console.error('[attendance/break/end POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
