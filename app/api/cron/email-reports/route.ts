import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { runDueEmailRules } from '@/lib/email-runner';

/**
 * The scheduler's entry point, called by system cron.
 *
 * No session: cron is not a browser. Authenticated by a shared secret, the same
 * pattern the DialShree webhook uses.
 *
 * Safe to call often. Each rule records the period it last completed, so running
 * every five minutes sends one email per period, and a run missed while the box
 * was down is picked up on the next tick rather than skipped for the day.
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

export async function POST(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error('[cron/email-reports] CRON_SECRET is not set — refusing to run');
    return NextResponse.json({ ok: false, error: 'Scheduler not configured' }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided = url.searchParams.get('token') ?? req.headers.get('x-cron-secret');
  if (!secretMatches(provided)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const outcomes = await runDueEmailRules(prisma, now);
    if (outcomes.length > 0) {
      console.log('[cron/email-reports]', JSON.stringify(outcomes));
    }
    return NextResponse.json({ ok: true, ran: outcomes.length, outcomes });
  } catch (err) {
    console.error('[cron/email-reports] failed:', err);
    return NextResponse.json({ ok: false, error: 'Scheduler run failed' }, { status: 500 });
  }
}

/** Lets an admin confirm the cron URL and secret without sending anything. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const provided = url.searchParams.get('token') ?? req.headers.get('x-cron-secret');
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok: false, error: 'Scheduler not configured' }, { status: 503 });
  }
  if (!secretMatches(provided)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const active = await prisma.emailRule.count({ where: { isActive: true } });
  return NextResponse.json({ ok: true, message: 'Email scheduler is live. POST here to run due rules.', activeRules: active });
}
