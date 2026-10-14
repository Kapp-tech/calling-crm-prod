import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

/**
 * Inbound results from the call-analytics tool.
 *
 * The outbound half (RECORDING_RECEIVED) hands over a recording and returns
 * immediately; analysis takes longer than a request should be held open, so the
 * tool calls back here when it has a verdict.
 *
 * AUTH — a shared secret, as `?token=` or an `x-webhook-secret` header, the
 * same shape the DialShree webhook uses so there is one convention to
 * configure. Compared in constant time: a plain `===` leaks the secret a byte
 * at a time to anyone who can measure the response.
 *
 * CORRELATION — on `event_id` (what we sent) or `call_id`. Scores that cannot
 * be tied to a call are rejected rather than stored loose: an orphaned score is
 * indistinguishable from a wrong one, and silently keeping it would put a
 * number on screen that belongs to a different call.
 *
 * IDEMPOTENT — upserted on the call, so a retry from the tool's side replaces
 * the verdict rather than erroring or duplicating it. Re-analysis is a
 * correction, not a second opinion.
 */

const CALL_ANALYSIS_SECRET = process.env.CALL_ANALYSIS_WEBHOOK_SECRET;

function secretMatches(provided: string | null): boolean {
  if (!CALL_ANALYSIS_SECRET || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(CALL_ANALYSIS_SECRET);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so the lengths are compared first and the result is the same.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Deliberately permissive about shape, strict about identity.
 *
 * The tool's payload will change before ours does, so everything but the
 * correlation key is optional and the untouched body is kept in `raw`. A field
 * we have not modelled is then recoverable without a migration and a redelivery.
 */
const schema = z.object({
  event_id: z.string().trim().min(1).optional(),
  call_id: z.string().trim().min(1).optional(),
  score: z.number().optional().nullable(),
  max_score: z.number().optional().nullable(),
  summary: z.string().optional().nullable(),
  feedback: z.string().optional().nullable(),
  metrics: z.unknown().optional(),
});

/** `rec_<callLogId>` is what buildCallTemplateData sends as event_id. */
function callIdFromEvent(eventId?: string): string | null {
  if (!eventId) return null;
  return eventId.startsWith('rec_') ? eventId.slice(4) : eventId;
}

export async function POST(req: NextRequest) {
  if (!CALL_ANALYSIS_SECRET) {
    console.error('[call-analysis webhook] CALL_ANALYSIS_WEBHOOK_SECRET is not set');
    return NextResponse.json({ success: false, error: 'Webhook not configured' }, { status: 503 });
  }

  const url = new URL(req.url);
  const provided = url.searchParams.get('token') ?? req.headers.get('x-webhook-secret');
  if (!secretMatches(provided)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const d = parsed.data;
  const callLogId = d.call_id ?? callIdFromEvent(d.event_id);
  if (!callLogId) {
    return NextResponse.json(
      { success: false, error: 'Provide call_id or event_id so the result can be matched to a call' },
      { status: 400 },
    );
  }

  const call = await prisma.callLog.findUnique({ where: { id: callLogId }, select: { id: true } });
  if (!call) {
    return NextResponse.json(
      { success: false, error: `No call found for "${callLogId}"` },
      { status: 404 },
    );
  }

  const fields = {
    score: d.score ?? null,
    maxScore: d.max_score ?? null,
    summary: d.summary ?? null,
    feedback: d.feedback ?? null,
    metrics: (d.metrics ?? null) as Prisma.InputJsonValue,
    raw: (body ?? {}) as Prisma.InputJsonValue,
  };

  await prisma.callAnalysis.upsert({
    where: { callLogId: call.id },
    create: { callLogId: call.id, ...fields },
    update: fields,
  });

  return NextResponse.json({ success: true, callId: call.id });
}

/** Lets the analytics tool confirm the URL and secret before going live. */
export async function GET(req: NextRequest) {
  if (!CALL_ANALYSIS_SECRET) {
    return NextResponse.json({ success: false, error: 'Webhook not configured' }, { status: 503 });
  }
  const url = new URL(req.url);
  const provided = url.searchParams.get('token') ?? req.headers.get('x-webhook-secret');
  if (!secretMatches(provided)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ success: true, message: 'Call analysis webhook is live. POST results here.' });
}
