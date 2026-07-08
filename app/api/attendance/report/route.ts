import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { closeStaleAttendanceRecords, getAttendanceDateString, summarizeAttendance } from '@/lib/attendance';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !['SUPER_ADMIN', 'COUNSELLING_TL'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const today = getAttendanceDateString();
    const from = searchParams.get('from') ?? today;
    const to = searchParams.get('to') ?? today;
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
    }

    const requestedIds = (searchParams.get('userIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const workType = searchParams.get('workType'); // 'WFH' | 'WFO' | null

    // Resolve which users this viewer is allowed to see, then narrow by the
    // requested filter (silently dropping any id outside that scope).
    let eligibleIds: string[];
    if (session.user.role === 'SUPER_ADMIN') {
      const users = await prisma.user.findMany({
        where: {
          role: { in: ['COUNSELLING_AGENT', 'COUNSELLING_TL'] },
          ...(workType === 'WFH' || workType === 'WFO' ? { workType } : {}),
        },
        select: { id: true },
      });
      eligibleIds = users.map((u) => u.id);
    } else {
      const agents = await prisma.user.findMany({
        where: {
          role: 'COUNSELLING_AGENT',
          OR: [{ managedById: session.user.id }, { team: { teamLeadId: session.user.id } }],
          ...(workType === 'WFH' || workType === 'WFO' ? { workType } : {}),
        },
        select: { id: true },
      });
      // For TL: include self only if workType matches (TLs always have a workType too)
      const selfUser = workType === 'WFH' || workType === 'WFO'
        ? await prisma.user.findUnique({ where: { id: session.user.id, workType }, select: { id: true } })
        : { id: session.user.id };
      eligibleIds = [...(selfUser ? [selfUser.id] : []), ...agents.map((a) => a.id)];
    }

    const userIds = requestedIds.length > 0
      ? eligibleIds.filter((id) => requestedIds.includes(id))
      : eligibleIds;

    if (userIds.length === 0) {
      return NextResponse.json([]);
    }

    // Sweep the whole table for stale open shifts so the report reflects
    // accurate auto-closed data even for agents who never reopen the app.
    await closeStaleAttendanceRecords();

    const records = await prisma.attendance.findMany({
      where: { userId: { in: userIds }, date: { gte: from, lte: to } },
      include: { breaks: true, user: { select: { id: true, name: true, role: true } } },
      orderBy: [{ date: 'desc' }],
    });

    const rows = records.map((r) => ({
      id: r.id,
      date: r.date,
      user: r.user,
      ...summarizeAttendance(r),
    }));

    rows.sort((a, b) => (a.date === b.date ? a.user.name.localeCompare(b.user.name) : 0));

    return NextResponse.json(rows);
  } catch (error) {
    console.error('[attendance/report GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
