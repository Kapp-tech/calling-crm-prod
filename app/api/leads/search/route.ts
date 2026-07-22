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

    // A plain "any field contains q, newest first" match makes results feel
    // random — e.g. searching "Rita" surfaces "PRITAM" (contains "rita" as a
    // substring) and anyone whose EMAIL happens to contain "rita" ahead of
    // someone actually named Rita, just because they were updated more
    // recently. Pull a wider candidate pool and rank it so the most likely
    // intent (name starts with the query) always comes first.
    const candidates = await prisma.lead.findMany({
      where: { AND: [getLeadWhereClause(session.user), { OR: or }] },
      take: 50,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        city: true,
        course: true,
        status: true,
        updatedAt: true,
        assignedTo: { select: { name: true } },
      },
    });

    const qLower = q.toLowerCase();
    const rank = (lead: (typeof candidates)[number]): number => {
      const name = lead.name.toLowerCase();
      if (name.startsWith(qLower)) return 0;
      if (lead.id.toLowerCase().includes(qLower)) return 1;
      if (digits.length >= 4 && lead.phone.replace(/\D/g, '').includes(digits)) return 1;
      if (name.includes(qLower)) return 2;
      if (lead.email.toLowerCase().includes(qLower)) return 3;
      return 4;
    };

    const leads = candidates
      .map((lead) => ({ lead, r: rank(lead) }))
      .sort((a, b) => a.r - b.r || b.lead.updatedAt.getTime() - a.lead.updatedAt.getTime())
      .slice(0, 10)
      .map(({ lead: { updatedAt: _updatedAt, ...lead } }) => lead);

    return NextResponse.json(leads);
  } catch (error) {
    console.error('[leads/search GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
