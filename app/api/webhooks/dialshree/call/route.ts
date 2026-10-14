import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { parseDialerCall, DialerWebhookError } from '@/lib/dialshree-webhook';
import { pushRecordingToIntegrations } from '@/lib/lead-integration-engine';

/**
 * DialShree's post-call webhook.
 *
 * The dialer POSTs one of these after every call, which is the CRM's only source
 * of talk time and recordings — click-to-call fires and forgets and gets no
 * call-progress events back.
 *
 * **No session.** This is called by the dialer, not a browser, so it is
 * authenticated by a shared secret instead: `?token=` on the URL or an
 * `x-webhook-secret` header. The provider's sample shows no auth header, hence
 * the query-string option.
 *
 * The reply is `{"status": true}` with HTTP 200 — the provider's sample records
 * exactly that as `api_response`, so it is what they expect to see back.
 */

export const dynamic = 'force-dynamic';

/** Constant-time compare, so a wrong secret cannot be found byte by byte. */
function secretMatches(provided: string | null): boolean {
  const expected = process.env.DIALSHREE_WEBHOOK_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself leak the
  // length, so unequal lengths are compared against a fixed-size digest-free
  // stand-in and always fail.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!process.env.DIALSHREE_WEBHOOK_SECRET) {
    console.error('[dialshree webhook] DIALSHREE_WEBHOOK_SECRET is not set — rejecting');
    return NextResponse.json({ status: false, error: 'Webhook not configured' }, { status: 503 });
  }

  const url = new URL(req.url);
  const provided = url.searchParams.get('token') ?? req.headers.get('x-webhook-secret');
  if (!secretMatches(provided)) {
    return NextResponse.json({ status: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Read the body as text first: it is logged verbatim on a parse failure, which
  // is the only way to diagnose a payload the provider changed without notice.
  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    console.error('[dialshree webhook] body was not valid JSON:', raw.slice(0, 1000));
    return NextResponse.json({ status: false, error: 'Body must be valid JSON' }, { status: 400 });
  }

  let facts;
  try {
    facts = parseDialerCall(body);
  } catch (err) {
    const message = err instanceof DialerWebhookError ? err.message : 'Could not read the call payload';
    console.error('[dialshree webhook] rejected:', message, raw.slice(0, 1000));
    return NextResponse.json({ status: false, error: message }, { status: 400 });
  }

  try {
    // Match the dialer seat to a CRM user. The seat id is the reliable link —
    // it is the same value click-to-call sends as `agent_user` — with email as a
    // fallback for calls the agent placed outside the CRM.
    const agent = facts.agentSeat
      ? await prisma.user.findUnique({ where: { dialshreeId: facts.agentSeat }, select: { id: true } })
      : facts.agentEmail
        ? await prisma.user.findFirst({ where: { email: facts.agentEmail }, select: { id: true } })
        : null;

    // Match the number to a lead. A phone can legitimately belong to more than
    // one lead here, so prefer one assigned to the agent who made the call and
    // fall back to the most recently touched — never guess silently across
    // agents.
    const lead =
      (agent
        ? await prisma.lead.findFirst({
            where: { phone: facts.phoneKey, assignedToId: agent.id },
            orderBy: { updatedAt: 'desc' },
            // name is carried so a missed-call notification can say who rang
            // rather than just quoting a phone number back at the agent.
            select: { id: true, name: true },
          })
        : null) ??
      (await prisma.lead.findFirst({
        where: { phone: facts.phoneKey },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true },
      }));

    const data = {
      leadId: lead?.id ?? null,
      agentId: agent?.id ?? null,
      phoneCode: facts.phoneCode,
      phoneNumber: facts.phoneNumber,
      agentSeat: facts.agentSeat,
      agentFullName: facts.agentFullName,
      agentEmail: facts.agentEmail,
      callType: facts.callType,
      campaign: facts.campaign,
      urlType: facts.urlType,
      startedAt: facts.startedAt,
      endedAt: facts.endedAt,
      durationSeconds: facts.durationSeconds,
      talkTimeSeconds: facts.talkTimeSeconds,
      ringTimeSeconds: facts.ringTimeSeconds,
      talkTimeRaw: facts.talkTimeRaw,
      ringTimeRaw: facts.ringTimeRaw,
      calledCount: facts.calledCount,
      lastLocalCallAt: facts.lastLocalCallAt,
      callStatus: facts.callStatus,
      connected: facts.connected,
      termReason: facts.termReason,
      dispositionDescription: facts.dispositionDescription,
      dialerLeadId: facts.dialerLeadId,
      recordingUrl: facts.recordingUrl,
      payload: body as Prisma.InputJsonValue,
    };

    // Whether this call is already on file, checked BEFORE the upsert. The
    // upsert cannot tell us afterwards, and the dialer retries — without this a
    // retry would ring the agent's browser a second time for the same call.
    const alreadyStored = facts.uniqueId
      ? (await prisma.callLog.findUnique({ where: { uniqueId: facts.uniqueId }, select: { id: true } })) !== null
      : false;

    // Idempotent when the dialer supplies its own call id, so a retry updates
    // rather than duplicating. Without one there is nothing to key on, and an
    // insert is the honest choice — a lost call is worse than a repeated one.
    const saved = facts.uniqueId
      ? await prisma.callLog.upsert({
          where: { uniqueId: facts.uniqueId },
          create: { uniqueId: facts.uniqueId, ...data },
          update: data,
        })
      : await prisma.callLog.create({ data });

    /**
     * Tell the agent, once, that somebody rang and got nothing.
     *
     * Only on a genuinely new call and only when the sticky tag resolved to a
     * real CRM user — a call attributed to nobody has nobody to notify. Failure
     * here must not fail the webhook: the call is already stored, and a 5xx
     * would make the dialer resend a call we have.
     */
    if (facts.missed && agent && !alreadyStored) {
      try {
        await prisma.notification.create({
          data: {
            userId: agent.id,
            type: 'MISSED_CALL',
            title: 'Missed call',
            body: lead
              ? `${lead.name} tried to reach you.`
              : `${facts.phoneNumber} rang and nobody picked up.`,
            leadId: lead?.id ?? null,
          },
        });
      } catch (err) {
        console.error('[dialshree webhook] missed-call notification failed:', err);
      }
    }

    if (!lead || !agent) {
      // Not an error — but worth a log line, because a persistent gap means a
      // seat is unmapped or a number was corrected after the call.
      console.warn(
        `[dialshree webhook] stored call ${saved.id} unmatched:` +
          `${lead ? '' : ` no lead for ${facts.phoneKey};`}${agent ? '' : ` no user for seat ${facts.agentSeat ?? '(none)'};`}`,
      );
    }

    /**
     * Hand the recording to any analytics webhook, without waiting for it.
     *
     * Deliberately not awaited. The dialer treats a non-200 — or a slow
     * response — as a failed delivery and retries, which would duplicate the
     * call record; the recording push must never be able to cause that. PM2
     * runs a persistent Node process, so work started here finishes after the
     * response is sent. The function swallows its own errors and logs every
     * attempt to LeadIntegrationLog, so a failure is visible without being
     * able to reach back into this request.
     *
     * Fires on every stored recording, matched to a lead or not: an inbound
     * call from a number the CRM does not know is still a call worth scoring.
     */
    if (saved.recordingUrl) {
      void pushRecordingToIntegrations(saved.id);
    }

    return NextResponse.json({ status: true });
  } catch (err) {
    console.error('[dialshree webhook] failed to store call:', err);
    // A 5xx invites the dialer to retry, which is what we want — the payload was
    // valid and the failure is ours.
    return NextResponse.json({ status: false, error: 'Could not store the call' }, { status: 500 });
  }
}

/** A GET is handy for the provider to confirm the URL and secret before going live. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const provided = url.searchParams.get('token') ?? req.headers.get('x-webhook-secret');
  if (!process.env.DIALSHREE_WEBHOOK_SECRET) {
    return NextResponse.json({ status: false, error: 'Webhook not configured' }, { status: 503 });
  }
  if (!secretMatches(provided)) {
    return NextResponse.json({ status: false, error: 'Unauthorized' }, { status: 401 });
  }
  return NextResponse.json({ status: true, message: 'DialShree call webhook is live. POST call data here.' });
}
