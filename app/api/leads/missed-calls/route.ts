import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isMaskedRole } from '@/lib/permissions';
import { maskContact, maskPhone } from '@/lib/data-masking';
import { istStartOfDay, istEndOfDay, istDayKey } from '@/lib/ist-time';

/**
 * Calls the lead placed to us that nobody picked up.
 *
 * The dialer reports these with `term_reason: "ABANDON"` — the caller hung up
 * before an agent answered. They were always being stored; what was missing was
 * an agent on them, because the `user` field is empty when nobody took the
 * call. `stickySeat` in lib/dialshree-webhook.ts now reads the seat out of the
 * `sticky<dialshreeId>` tag the dialer puts in `security_phrase`/`campaign`, so
 * these rows land on the agent the lead was trying to reach.
 *
 * Read from CallLog rather than a new table: the rows are already there, and
 * "missed" is a property of the call the dialer already told us about, not a
 * separate thing to record.
 */

const ABANDON = 'ABANDON';

const querySchema = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(25),
  from:  z.string().optional(),
  to:    z.string().optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { page, limit, from, to } = parsed.data;

  // Same scoping as Scheduled Calls: an agent sees their own, a TL their team,
  // a manager everyone. Derived from the session, never from a parameter.
  const agentWhere: Prisma.CallLogWhereInput =
    session.user.role === 'COUNSELLING_AGENT'
      ? { agentId: session.user.id }
      : session.user.role === 'COUNSELLING_TL'
        ? { agent: { managedById: session.user.id } }
        : {};

  const dateWhere: Prisma.CallLogWhereInput = from || to
    ? { startedAt: { ...(from ? { gte: istStartOfDay(from) } : {}), ...(to ? { lte: istEndOfDay(to) } : {}) } }
    : {};

  const where: Prisma.CallLogWhereInput = {
    // Case-insensitive: the value is the dialer's, not ours, and a change of
    // casing at their end should not silently empty this page.
    termReason: { equals: ABANDON, mode: 'insensitive' },
    ...agentWhere,
    ...dateWhere,
  };

  try {
    const now = new Date();
    const [rows, total, todayCount, unmatched] = await Promise.all([
      prisma.callLog.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        // Newest first: a missed call matters most while it is still fresh.
        orderBy: { startedAt: 'desc' },
        select: {
          id: true, phoneNumber: true, phoneCode: true, agentSeat: true,
          startedAt: true, endedAt: true, ringTimeSeconds: true, calledCount: true,
          termReason: true, campaign: true, recordingUrl: true,
          agent: { select: { id: true, name: true } },
          lead: {
            select: {
              id: true, name: true, email: true, phone: true,
              city: true, state: true, course: true, college: true,
              assignedTo: { select: { id: true, name: true } },
              feedbacks: {
                take: 1,
                orderBy: { followUpNumber: 'desc' },
                select: { followUpNumber: true, feedbackOption: { select: { label: true } } },
              },
            },
          },
        },
      }),
      prisma.callLog.count({ where }),
      prisma.callLog.count({
        where: { ...where, startedAt: { gte: istStartOfDay(istDayKey(now)), lte: istEndOfDay(istDayKey(now)) } },
      }),
      // Worth surfacing rather than hiding: a missed call from a number that
      // matches no lead is still someone who rang and got nothing back.
      prisma.callLog.count({ where: { ...where, leadId: null } }),
    ]);

    const masked = await isMaskedRole(session.user.role);

    return NextResponse.json({
      calls: rows.map((c) => ({
        ...c,
        // The caller's number is contact detail like any other, so it follows
        // the same Mask Data rule as the lead's own.
        phoneNumber: masked ? maskPhone(c.phoneNumber) : c.phoneNumber,
        lead: c.lead ? maskContact(c.lead, masked) : null,
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
      counts: { today: todayCount, unmatched },
      masked,
    });
  } catch (err) {
    console.error('[missed-calls GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
