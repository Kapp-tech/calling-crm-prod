import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { closeStaleAttendanceRecords, getAttendanceDateString, summarizeAttendance } from '@/lib/attendance';
import { clientIpFrom } from '@/lib/client-ip';

const PUNCH_ROLES = ['COUNSELLING_AGENT', 'COUNSELLING_TL'];

export async function POST(req: NextRequest) {
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

    if (existing) {
      if (existing.punchOutAt) {
        return NextResponse.json({ error: 'You have already completed your shift for today' }, { status: 409 });
      }
      // Already punched in (e.g. duplicate click / refresh race) — just return current state.
      return NextResponse.json(summarizeAttendance(existing));
    }

    const now = new Date();
    const created = await prisma.attendance.create({
      // Recorded once, at check-in. Not refreshed afterwards: the question this
      // answers is "where was the shift started from", and a heartbeat-tracked
      // value would just show wherever they last had the tab open.
      data: {
        userId: session.user.id, date, punchInAt: now, lastHeartbeatAt: now,
        punchInIp: clientIpFrom(req.headers),
      },
      include: { breaks: true },
    });

    return NextResponse.json(summarizeAttendance(created), { status: 201 });
  } catch (error) {
    console.error('[attendance/punch-in POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
