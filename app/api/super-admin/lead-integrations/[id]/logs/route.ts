import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
  from: z.string().optional(),
  to: z.string().optional(),
});

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid query parameters' }, { status: 400 });
    }
    const { page, limit, from, to } = parsed.data;

    const where = {
      integrationId: params.id,
      ...((from || to)
        ? {
            attemptedAt: {
              ...(from ? { gte: new Date(from) } : {}),
              // End-of-day so a same-day from/to range doesn't exclude
              // everything that happened after midnight on that date.
              ...(to ? { lte: new Date(`${to}T23:59:59.999`) } : {}),
            },
          }
        : {}),
    };

    const [logs, total] = await Promise.all([
      prisma.leadIntegrationLog.findMany({
        where,
        orderBy: { attemptedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { lead: { select: { id: true, name: true } } },
      }),
      prisma.leadIntegrationLog.count({ where }),
    ]);

    return NextResponse.json({ logs, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id]/logs GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
