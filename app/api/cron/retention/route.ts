import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { purgeOldLogs, retentionMonths } from '@/lib/log-retention';

/**
 * Nightly log tidy-up, called by system cron.
 *
 * Same shared-secret auth as the email scheduler — cron is not a browser.
 *
 * A GET reports what *would* be deleted and removes nothing, so the effect can
 * always be checked before it happens. Only POST deletes, and deletion is
 * irreversible: there is no undo and the rows are not archived anywhere.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function secretMatches(provided: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function authorise(req: NextRequest): NextResponse | null {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'Scheduler not configured' }, { status: 503 });
  }
  const provided =
    new URL(req.url).searchParams.get('token') ?? req.headers.get('x-cron-secret');
  if (!secretMatches(provided)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return null;
}

/** Dry run — what the next purge would remove. */
export async function GET(req: NextRequest) {
  const denied = authorise(req);
  if (denied) return denied;
  try {
    const report = await purgeOldLogs(prisma, { apply: false });
    return NextResponse.json({ ok: true, dryRun: true, ...report });
  } catch (err) {
    console.error('[cron/retention] dry run failed:', err);
    return NextResponse.json({ ok: false, error: 'Dry run failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = authorise(req);
  if (denied) return denied;
  try {
    const report = await purgeOldLogs(prisma, { apply: true });
    const removed = report.results.reduce((n, r) => n + r.deleted, 0);
    // Logged only when something happened, so a nightly no-op stays quiet and a
    // real purge is easy to find afterwards.
    if (removed > 0) {
      console.log(
        `[cron/retention] kept ${retentionMonths()} months, removed ${removed} row(s):`,
        JSON.stringify(report.results),
      );
    }
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error('[cron/retention] purge failed:', err);
    return NextResponse.json({ ok: false, error: 'Purge failed' }, { status: 500 });
  }
}
