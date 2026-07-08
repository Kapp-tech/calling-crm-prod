import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
  const session = await getServerSession(authOptions);
  if (!session || (session.user.role !== 'SUPER_ADMIN' && session.user.role !== 'REPORTS')) {
    return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
  }

  const [sa, opsGroups, teams] = await Promise.all([
    prisma.user.findFirst({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true, name: true, email: true, employeeCode: true, isActive: true, phone: true, joiningDate: true },
    }),
    prisma.operationsGroup.findMany({
      include: {
        members: {
          select: {
            id: true, name: true, email: true, phone: true, employeeCode: true,
            isActive: true, status: true, joiningDate: true,
            _count: { select: { uploadBatches: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.team.findMany({
      where: { isActive: true },
      include: {
        teamLead: {
          select: {
            id: true, name: true, email: true, phone: true, employeeCode: true,
            isActive: true, status: true, joiningDate: true,
            _count: { select: { assignedByLeads: true } },
          },
        },
        members: {
          where: { role: 'COUNSELLING_AGENT' },
          select: {
            id: true, name: true, email: true, phone: true, employeeCode: true,
            isActive: true, status: true, joiningDate: true,
            _count: { select: { assignedLeads: true, feedbacks: true } },
          },
        },
        _count: { select: { leads: true } },
      },
      orderBy: { name: 'asc' },
    }),
  ]);

  // Pending agents not yet assigned to a team
  const pendingAgents = await prisma.user.findMany({
    where: { role: 'COUNSELLING_AGENT', status: 'PENDING_APPROVAL' },
    select: {
      id: true, name: true, email: true, phone: true, employeeCode: true,
      isActive: true, status: true, joiningDate: true, teamId: true,
      manager: { select: { id: true, name: true } },
    },
  });

  const reports = await prisma.user.findMany({
    where: { role: 'REPORTS' },
    select: {
      id: true, name: true, email: true, phone: true, employeeCode: true,
      isActive: true, status: true, joiningDate: true,
    },
  });

  return NextResponse.json({ sa, opsGroups, teams, pendingAgents, reports });
  } catch (error) {
    console.error('[users/hierarchy GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
