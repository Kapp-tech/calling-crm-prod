import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redeliverLog, abandonRetry } from '@/lib/integration-redelivery';

/**
 * Re-sends failed integration deliveries that have come due.
 *
 * Same shape as the other crons here: POST with `x-cron-secret`, driven by the
 * server's crontab rather than an in-process timer, so a pm2 restart cannot
 * lose the schedule and two app instances cannot both fire it.
 *
 * Deliveries schedule their own next attempt when they fail (see
 * RETRY_DELAYS_MINUTES in the engine); this route only picks up what is due.
 * That keeps the backoff policy in one place rather than split between the
 * writer and the reader.
 */

const CRON_SECRET = process.env.CRON_SECRET;

/**
 * A bounded batch, deliberately.
 *
 * At ~3,800 recordings a day a broken receiver can leave thousands of rows due
 * at once. Draining them in one pass would hold the connection pool — eight
 * connections on one physical core — for as long as it took, and starve the
 * agents actually using the CRM. Whatever is left is simply picked up by the
 * next run.
 */
const BATCH_SIZE = 25;

export async function POST(req: NextRequest) {
  if (!CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'CRON_SECRET is not configured' }, { status: 503 });
  }
  if (req.headers.get('x-cron-secret') !== CRON_SECRET) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const due = await prisma.leadIntegrationLog.findMany({
    where: { nextRetryAt: { not: null, lte: new Date() }, success: false },
    // Oldest first, so a backlog drains in the order it formed instead of
    // starving the earliest failures behind newer ones.
    orderBy: { nextRetryAt: 'asc' },
    take: BATCH_SIZE,
    select: { id: true },
  });

  let retried = 0;
  let succeeded = 0;
  let abandoned = 0;

  for (const { id } of due) {
    /**
     * Cleared BEFORE the attempt, not after.
     *
     * The new attempt writes its own log row carrying its own nextRetryAt, so
     * this row's job is done either way. Clearing first also means a crash
     * mid-send cannot leave the row due forever, re-sent on every sweep.
     */
    await prisma.leadIntegrationLog.update({ where: { id }, data: { nextRetryAt: null } });

    const outcome = await redeliverLog(id);
    if (!outcome.ok) {
      await abandonRetry(id, outcome.reason);
      abandoned += 1;
      continue;
    }
    retried += 1;
    if (outcome.result.success) succeeded += 1;
  }

  return NextResponse.json({
    success: true,
    due: due.length,
    retried,
    succeeded,
    abandoned,
    // Says whether the batch was capped, so a growing backlog is visible in the
    // cron's own output rather than only in the table.
    more: due.length === BATCH_SIZE,
  });
}
