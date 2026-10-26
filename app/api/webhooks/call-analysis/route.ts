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
 * The analyser's payload will change before ours does, so every field but the
 * correlation keys is optional and the untouched body is kept in `raw`. A
 * field we have not modelled is then recoverable without a migration and a
 * redelivery.
 *
 * Both casings are accepted. The live analyser sends `call_Unique_Id` and
 * `event_Id` — capital I, mid-word — while the outbound half of this
 * integration emits `call_id` and `event_id`. Matching only one would make
 * correlation depend on which side you read, so each key is tried in both
 * spellings rather than picking a winner and asking the tool to change.
 */
const num = z.union([z.number(), z.null()]).optional();

const schema = z
  .object({
    event_id: z.string().trim().optional(),
    event_Id: z.string().trim().optional(),
    call_id: z.string().trim().optional(),
    call_Id: z.string().trim().optional(),
    call_unique_id: z.string().trim().optional(),
    call_Unique_Id: z.string().trim().optional(),

    qa_status: z.string().trim().optional().nullable(),
    qa_score: num,
    max_score: num,
    qa_grade: z.string().trim().optional().nullable(),
    intent: z.string().trim().optional().nullable(),
    fatal_error: z.boolean().optional().nullable(),
    needs_review: z.boolean().optional().nullable(),
    red_flags: z.array(z.string()).optional().nullable(),

    summary: z.string().optional().nullable(),
    feedback: z.string().optional().nullable(),
    qa_scores: z.record(num).optional().nullable(),
    metrics: z.unknown().optional(),
    scored_at: z.string().trim().optional().nullable(),

    // Still accepted so the earlier contract keeps working unchanged.
    score: num,
  })
  .passthrough();

/** First non-empty of the aliases — the payload may use either spelling. */
function pick(...vals: (string | undefined)[]): string | undefined {
  return vals.find((v) => v && v.trim().length > 0)?.trim();
}

/** `rec_<callLogId>` is what buildCallTemplateData sends as the event id. */
function callIdFromEvent(eventId?: string): string | undefined {
  if (!eventId) return undefined;
  return eventId.startsWith('rec_') ? eventId.slice(4) : eventId;
}

/**
 * Only a real Date, never Invalid Date.
 *
 * `new Date("not a date")` yields an object Prisma will happily try to write
 * and Postgres will reject, failing the whole callback over a cosmetic field.
 */
function parseDate(v?: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
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

  /**
   * Three ways to name the call, tried hardest-first.
   *
   * `call_Id` is our own CallLog id and matches exactly. `event_Id` carries
   * the same id behind a `rec_` prefix. `call_Unique_Id` is the DIALER's id,
   * which we store on CallLog.uniqueId — the only one of the three that is
   * meaningful to the analyser without us having told it, so it is the
   * fallback that keeps working if the other two are ever dropped.
   */
  const directId = pick(d.call_id, d.call_Id) ?? callIdFromEvent(pick(d.event_id, d.event_Id));
  const dialerId = pick(d.call_unique_id, d.call_Unique_Id);

  if (!directId && !dialerId) {
    return NextResponse.json(
      {
        success: false,
        error: 'Provide call_Id, event_Id or call_Unique_Id so the result can be matched to a call',
      },
      { status: 400 },
    );
  }

  const call =
    (directId
      ? await prisma.callLog.findUnique({ where: { id: directId }, select: { id: true } })
      : null) ??
    (dialerId
      ? await prisma.callLog.findUnique({ where: { uniqueId: dialerId }, select: { id: true } })
      : null);

  if (!call) {
    return NextResponse.json(
      { success: false, error: `No call found for ${JSON.stringify({ call_Id: directId, call_Unique_Id: dialerId })}` },
      { status: 404 },
    );
  }

  // qa_scores is this analyser's name for what we store as metrics; the older
  // `metrics` key still works for anything already pointed at this endpoint.
  const metrics = d.qa_scores ?? d.metrics ?? null;
  const score = d.qa_score ?? d.score ?? null;

  /**
   * A verdict with nothing in it is not stored.
   *
   * The analyser reports back on every recording it is handed, including the
   * ones it declines to judge — a 21-second call comes through as
   * `qa_status: "not_scored"` with score, grade and qa_scores all null. Those
   * carry no analysis, so storing them would fill the Call Analysis list with
   * empty rows, drag the average down with blanks and show a lead a score
   * circle with nothing in it.
   *
   * The test is on the payload's substance rather than on `qa_status`, so a
   * future status string we have never seen still does the right thing: if
   * there is neither an overall score nor a single criterion, there is
   * nothing to analyse.
   *
   * This answers 200, not an error. The analyser behaved correctly and must
   * not retry — we are simply declining to keep the result.
   */
  const hasMetrics =
    metrics !== null &&
    typeof metrics === 'object' &&
    Object.values(metrics as Record<string, unknown>).some((v) => typeof v === 'number');

  if (score === null && !hasMetrics) {
    // Never clears a verdict already on file: a later empty report must not
    // wipe a real score the analyser sent earlier.
    return NextResponse.json({
      success: true,
      stored: false,
      callId: call.id,
      reason: d.qa_status
        ? `No score in this payload (qa_status: ${d.qa_status}) — nothing stored`
        : 'No score and no criteria in this payload — nothing stored',
    });
  }

  const fields = {
    score,
    /**
     * Defaults to 100 when a score arrived without a scale.
     *
     * Every number this analyser sends is a percentage — 86.14 overall, and
     * 0–100 per criterion — so the scale is knowable. Leaving it null would
     * make the UI unable to colour the score, since 86 is excellent out of
     * 100 and impossible out of 10.
     */
    maxScore: d.max_score ?? (score !== null ? 100 : null),
    qaStatus: d.qa_status ?? null,
    qaGrade: d.qa_grade ?? null,
    intent: d.intent ?? null,
    fatalError: d.fatal_error ?? false,
    needsReview: d.needs_review ?? false,
    redFlags: (d.red_flags ?? null) as Prisma.InputJsonValue,
    summary: d.summary ?? null,
    feedback: d.feedback ?? null,
    metrics: metrics as Prisma.InputJsonValue,
    scoredAt: parseDate(d.scored_at),
    raw: (body ?? {}) as Prisma.InputJsonValue,
  };

  await prisma.callAnalysis.upsert({
    where: { callLogId: call.id },
    create: { callLogId: call.id, ...fields },
    update: fields,
  });

  return NextResponse.json({ success: true, callId: call.id, score, grade: d.qa_grade ?? null });
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
