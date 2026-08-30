import { PrismaClient } from '@prisma/client';
import { getAttendanceDateString } from './attendance';

/**
 * "Has this person marked attendance today?"
 *
 * Enforced on the server, not in the browser: a disabled button is a courtesy,
 * but the API is what actually stops an agent working off the clock.
 *
 * ONLY counselling agents are gated. A TL or an admin acting on a lead is doing
 * something administrative and should not be blocked by their own punch clock.
 *
 * Only NOT_PUNCHED_IN is refused — deliberately:
 *
 *  - ON BREAK still counts as present. Blocking it would stop an agent taking a
 *    callback during lunch, and they can end the break themselves anyway.
 *  - PUNCHED OUT still counts, and this one matters: punch-in refuses with 409
 *    ("You have already completed your shift for today") once a shift is
 *    closed, so blocking a punched-out agent would strand them for the rest of
 *    the day with no way back in. That is a lockout, not a check.
 */
export async function needsCheckIn(
  db: PrismaClient,
  user: { id: string; role: string },
): Promise<boolean> {
  if (user.role !== 'COUNSELLING_AGENT') return false;
  const record = await db.attendance.findUnique({
    where: { userId_date: { userId: user.id, date: getAttendanceDateString() } },
    select: { id: true },
  });
  return record === null;
}
