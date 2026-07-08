import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { closeStaleAttendanceRecords, getAttendanceDateString, summarizeAttendance } from '@/lib/attendance';

const PUNCH_ROLES = ['COUNSELLING_AGENT', 'COUNSELLING_TL'];

export async function POST() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !PUNCH_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await closeStaleAttendanceRecords({ userId: session.user.id });

    const date = getAttendanceDateString();
    const existing = await prisma.attendance.findUnique({
      where: { userId_date: { userId: session.user.id, date } },
      include: { breaks: true },
    });

    if (!existing) {
      return NextResponse.json({ error: 'You have not punched in today' }, { status: 409 });
    }
    if (existing.punchOutAt) {
      return NextResponse.json(summarizeAttendance(existing));
    }

    const now = new Date();

    // Punching out while on a break auto-ends that break at the same moment.
    await prisma.attendanceBreak.updateMany({
      where: { attendanceId: existing.id, endAt: null },
      data: { endAt: now },
    });

    const updated = await prisma.attendance.update({
      where: { id: existing.id },
      data: { punchOutAt: now, lastHeartbeatAt: now },
      include: { breaks: true },
    });

    return NextResponse.json(summarizeAttendance(updated));
  } catch (error) {
    console.error('[attendance/punch-out POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
