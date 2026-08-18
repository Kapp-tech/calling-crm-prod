import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { istEndOfDay } from '@/lib/ist-time';

const querySchema = z.object({
  status:  z.enum(['PENDING', 'DONE', 'CANCELLED', 'all']).default('PENDING'),
  // Splits PENDING by whether the slot has passed. The Pending tab lists only
  // what is still to come; overdue calls get their own tab so they are worked
  // through deliberately rather than sitting mixed in with future ones.
  timing:  z.enum(['upcoming', 'overdue', 'any']).default('any'),
  page:    z.coerce.number().int().positive().default(1),
  limit:   z.coerce.number().int().positive().max(500).default(20),
  from:    z.string().optional(),
  to:      z.string().optional(),
});

const patchSchema = z.object({
  id:     z.string().min(1),
  status: z.enum(['DONE', 'CANCELLED']),
});

/**
 * Marks a scheduled call done (or cancelled) from the Scheduled Calls list.
 *
 * There is already a PATCH on /api/leads/[id]/schedule, but it is hard-scoped to
 * `agentId: session.user.id` — only the owning agent can use it. This page is
 * also used by TLs and Super Admins, who can see other people's calls, so the
 * authorisation here mirrors the GET's role scoping: an agent may only touch
 * their own, a TL their agents', SA/REPORTS any. That keeps "can act on it"
 * identical to "can see it".
 */
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });

  const agentWhere =
    session.user.role === 'COUNSELLING_AGENT'
      ? { agentId: session.user.id }
      : session.user.role === 'COUNSELLING_TL'
      ? { agent: { managedById: session.user.id } }
      : {};

  try {
    const updated = await prisma.scheduledCall.updateMany({
      // Only a PENDING call can be completed — re-clicking a row that another
      // tab already closed must not silently "reopen" and rewrite it.
      where: { id: parsed.data.id, status: 'PENDING', ...agentWhere },
      data:  { status: parsed.data.status },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: 'Call not found, already closed, or not yours' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[scheduled-calls PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { status, timing, page, limit, from, to } = parsed.data;
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

  // `timing` and from/to both constrain scheduledAt, so they are merged rather
  // than one silently overwriting the other (the calendar view passes from/to).
  const now = new Date();
  const timingWhere =
    timing === 'upcoming' ? { gte: now }
    : timing === 'overdue' ? { lt: now }
    : undefined;

  const scheduledAtWhere = {
    ...((dateWhere.scheduledAt as Record<string, Date> | undefined) ?? {}),
    ...(timingWhere ?? {}),
  };

  const where = {
    ...agentWhere,
    ...statusWhere,
    ...(Object.keys(scheduledAtWhere).length > 0 ? { scheduledAt: scheduledAtWhere } : {}),
  };

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

    // Counts over the whole role-scoped PENDING set, not just this page. They
    // used to be derived client-side from the rows on screen, so with
    // pagination the summary only described what happened to be visible — and
    // now that Pending excludes overdue, counting from the page would report
    // zero overdue however many exist.
    const pendingBase = { ...agentWhere, status: 'PENDING' as const };
    const istTodayEnd = istEndOfDay(now);
    const [overdueCount, todayCount, upcomingCount] = await Promise.all([
      prisma.scheduledCall.count({ where: { ...pendingBase, scheduledAt: { lt: now } } }),
      // "Today" is the rest of today in IST — a slot already past counts as
      // overdue rather than today, matching how the row pills are coloured.
      prisma.scheduledCall.count({ where: { ...pendingBase, scheduledAt: { gte: now, lte: istTodayEnd } } }),
      prisma.scheduledCall.count({ where: { ...pendingBase, scheduledAt: { gt: istTodayEnd } } }),
    ]);

    return NextResponse.json({
      calls, total, page, limit, totalPages: Math.ceil(total / limit),
      counts: { overdue: overdueCount, today: todayCount, upcoming: upcomingCount },
    });
  } catch (err) {
    console.error('[scheduled-calls GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
