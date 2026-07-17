import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import type { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getLeadWhereClause } from '@/lib/lead-access';

// Global quick-search (Ctrl+K palette). Results are scoped through
// getLeadWhereClause, so every role only ever sees leads it could open anyway.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const q = (new URL(req.url).searchParams.get('q') ?? '').trim();
    if (q.length < 2) return NextResponse.json([]);

    const or: Prisma.LeadWhereInput[] = [
      { id: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
    ];
    // Match phone on digits only, so "98765 43210" or "+91-98..." still hits
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 4) or.push({ phone: { contains: digits } });

    const leads = await prisma.lead.findMany({
      where: { AND: [getLeadWhereClause(session.user), { OR: or }] },
      take: 10,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        city: true,
        course: true,
        status: true,
        assignedTo: { select: { name: true } },
      },
    });

    return NextResponse.json(leads);
  } catch (error) {
    console.error('[leads/search GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
