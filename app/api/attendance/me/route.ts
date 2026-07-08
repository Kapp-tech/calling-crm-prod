import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { closeStaleAttendanceRecords, getAttendanceDateString, summarizeAttendance } from '@/lib/attendance';

const PUNCH_ROLES = ['COUNSELLING_AGENT', 'COUNSELLING_TL'];

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !PUNCH_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await closeStaleAttendanceRecords({ userId: session.user.id });

    const record = await prisma.attendance.findUnique({
      where: { userId_date: { userId: session.user.id, date: getAttendanceDateString() } },
      include: { breaks: true },
    });

    return NextResponse.json(summarizeAttendance(record));
  } catch (error) {
    console.error('[attendance/me GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
