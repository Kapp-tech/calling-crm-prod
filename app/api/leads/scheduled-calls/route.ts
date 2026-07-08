import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const querySchema = z.object({
  status:  z.enum(['PENDING', 'DONE', 'CANCELLED', 'all']).default('PENDING'),
  page:    z.coerce.number().int().positive().default(1),
  limit:   z.coerce.number().int().positive().max(500).default(20),
  from:    z.string().optional(),
  to:      z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { status, page, limit, from, to } = parsed.data;
  const skip = (page - 1) * limit;

  // Role-scoped agent filter
  const agentWhere =
    session.user.role === 'COUNSELLING_AGENT'
      ? { agentId: session.user.id }
      : session.user.role === 'COUNSELLING_TL'
      ? { agent: { managedById: session.user.id } }
      : {}; // SA / REPORTS see all

  const statusWhere =
    status === 'all' ? {} : { status: status as 'PENDING' | 'DONE' | 'CANCELLED' };

  const dateWhere: Record<string, unknown> = {};
  if (from || to) {
    dateWhere.scheduledAt = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    };
  }

  const where = { ...agentWhere, ...statusWhere, ...dateWhere };

  try {
    const [calls, total] = await Promise.all([
      prisma.scheduledCall.findMany({
        where,
        skip,
        take: limit,
        orderBy: { scheduledAt: 'asc' },
        include: {
          agent: { select: { id: true, name: true } },
          lead: {
            select: {
              id: true, name: true, email: true, phone: true,
              city: true, state: true, course: true, college: true,
              campaign: true, leadType: true, leadOrigin: true, leadZone: true,
              status: true, createdAt: true, updatedAt: true,
              assignedTo: { select: { id: true, name: true } },
              feedbacks: {
                take: 1,
                orderBy: { followUpNumber: 'desc' },
                select: { followUpNumber: true, feedbackOption: { select: { label: true } } },
              },
              _count: { select: { feedbacks: true } },
            },
          },
        },
      }),
      prisma.scheduledCall.count({ where }),
    ]);

    return NextResponse.json({ calls, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[scheduled-calls GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
