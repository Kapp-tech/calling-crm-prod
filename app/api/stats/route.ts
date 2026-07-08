import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [totalUsers, activeUsers, totalLeads, pendingLeads, approvedLeads, disapprovedLeads, totalBatches] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.lead.count(),
      prisma.lead.count({ where: { status: 'PENDING' } }),
      prisma.lead.count({ where: { status: 'APPROVED' } }),
      prisma.lead.count({ where: { status: 'DISAPPROVED' } }),
      prisma.uploadBatch.count(),
    ]);

  return NextResponse.json({
    totalUsers,
    activeUsers,
    totalLeads,
    pendingLeads,
    approvedLeads,
    disapprovedLeads,
    totalBatches,
  });
  } catch (error) {
    console.error('[stats GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
