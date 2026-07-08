import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (session.user.role === 'SUPER_ADMIN') {
      const users = await prisma.user.findMany({
        where: { role: { in: ['COUNSELLING_AGENT', 'COUNSELLING_TL'] }, isActive: true },
        select: { id: true, name: true, role: true, workType: true },
        orderBy: { name: 'asc' },
      });
      return NextResponse.json(users);
    }

    if (session.user.role === 'COUNSELLING_TL') {
      const self = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, name: true, role: true, workType: true },
      });
      const agents = await prisma.user.findMany({
        where: {
          role: 'COUNSELLING_AGENT',
          isActive: true,
          OR: [{ managedById: session.user.id }, { team: { teamLeadId: session.user.id } }],
        },
        select: { id: true, name: true, role: true, workType: true },
        orderBy: { name: 'asc' },
      });
      return NextResponse.json(self ? [self, ...agents] : agents);
    }

    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  } catch (error) {
    console.error('[attendance/agents GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
