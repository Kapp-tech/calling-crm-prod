import { prisma } from '@/lib/prisma';
import type { Notification } from '@prisma/client';

/**
 * Creates CALL_REMINDER / CALL_NOW notifications for a user's due/upcoming
 * scheduled calls. Single source of truth — called from both the SSE stream
 * route (for real-time push) and the plain GET /api/notifications route (the
 * bell's 10s fallback poll), so the two can never drift out of sync again.
 *
 * Candidates are fetched by non-temporal flags only (agent, status, sent
 * flags) and the actual time-window decision is made with plain JS Date
 * arithmetic. `scheduledAt` is a `timestamp without time zone` column, and
 * letting Postgres compare it against a timezone-aware parameter is brittle
 * (implicit casts can apply the DB session's UTC offset) — millisecond
 * comparison in application code is the unambiguous source of truth for
 * whether a call is "still upcoming" vs "already due".
 */
export async function createDueScheduledCallNotifications(userId: string): Promise<Notification[]> {
  const now = new Date();
  const created: Notification[] = [];

  // Reminders for upcoming scheduled calls (within the next 10 min). Claim
  // each row atomically (updateMany with the same reminderSent:false guard in
  // the WHERE clause) before creating its notification, so two callers racing
  // the same moment (e.g. the SSE tick and a concurrent poll request, or
  // multiple open tabs/devices) can't both pass the check and double-create.
  const reminderCandidates = await prisma.scheduledCall.findMany({
    where:   { agentId: userId, status: 'PENDING', reminderSent: false },
    include: { lead: { select: { id: true, name: true } } },
  });
  const tenMinLaterMs = now.getTime() + 10 * 60 * 1000;
  const upcoming = reminderCandidates.filter((c) => {
    const t = c.scheduledAt.getTime();
    return t > now.getTime() && t <= tenMinLaterMs;
  });

  for (const call of upcoming) {
    const claimed = await prisma.scheduledCall.updateMany({
      where: { id: call.id, reminderSent: false },
      data:  { reminderSent: true },
    });
    if (claimed.count === 0) continue; // another caller already claimed it

    const mins = Math.ceil((call.scheduledAt.getTime() - now.getTime()) / 60000);
    created.push(await prisma.notification.create({
      data: {
        userId,
        type:       'CALL_REMINDER',
        title:      'Call Reminder',
        body:       `Scheduled call with ${call.lead.name} in ${mins} minute${mins !== 1 ? 's' : ''}.`,
        leadId:     call.leadId,
        scheduleId: call.id,
      },
    }));
  }

  // "Call Now" — scheduled time has arrived (never fires early). No lower
  // bound: if nobody was watching exactly when a call came due (e.g. agent
  // away from the screen), this still catches up and sends exactly one
  // notification rather than silently missing it.
  const nowCandidates = await prisma.scheduledCall.findMany({
    where:   { agentId: userId, status: 'PENDING', nowSent: false },
    include: { lead: { select: { id: true, name: true } } },
  });
  const callsNow = nowCandidates.filter((c) => c.scheduledAt.getTime() <= now.getTime());

  for (const call of callsNow) {
    const claimed = await prisma.scheduledCall.updateMany({
      where: { id: call.id, nowSent: false },
      data:  { nowSent: true },
    });
    if (claimed.count === 0) continue; // another caller already claimed it

    const lateMins = Math.floor((now.getTime() - call.scheduledAt.getTime()) / 60000);
    const body = lateMins <= 1
      ? `Your scheduled call with ${call.lead.name} is now.`
      : `Your scheduled call with ${call.lead.name} was due ${lateMins} minutes ago.`;
    created.push(await prisma.notification.create({
      data: {
        userId,
        type:       'CALL_NOW',
        title:      'Time to Call!',
        body,
        leadId:     call.leadId,
        scheduleId: call.id,
      },
    }));
  }

  return created;
}
