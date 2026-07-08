import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ActivityAction } from '@prisma/client';

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action') as ActivityAction | null;
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const where = {
      ...(action ? { action } : {}),
      ...(from && to ? { createdAt: { gte: new Date(from), lte: new Date(to) } } : {}),
    };

    const logs = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 5000,
      include: { user: { select: { name: true, role: true, employeeCode: true } } },
    });

    const headers = ['Time', 'Action', 'By', 'Employee Code', 'Role', 'Description', 'Target Type'];
    const rows = logs.map((log) =>
      [
        new Date(log.createdAt).toISOString(),
        log.action,
        log.user.name,
        log.user.employeeCode,
        log.user.role,
        log.description,
        log.targetType ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="activity-logs-${Date.now()}.csv"`,
      },
    });
  } catch (error) {
    console.error('[activity-logs/export GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
