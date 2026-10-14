import { Prisma, type LeadIntegration, type LeadIntegrationTrigger } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptSecret, encryptSecret, maskSecret, SECRET_UNCHANGED_SENTINEL } from '@/lib/integration-crypto';
import { renderTemplate, renderText } from '@/lib/lead-integration-template';
import { buildLeadTemplateData, type PushSource } from '@/lib/lead-integration-data';
import { buildCallTemplateData } from '@/lib/call-integration-data';

export interface IntegrationHeader {
  key: string;
  value: string;
  isSecret: boolean;
}

export interface IntegrationParam {
  key: string;
  value: string;
}

export interface ExecuteResult {
  success: boolean;
  responseStatus: number | null;
  responseBody: string | null;
  errorMessage: string | null;
}

interface ExecuteOptions {
  leadId?: string | null;
  /** Set for recording deliveries — one lead has many calls, so the log has to
   *  name which one, and a retry has to resend the same call. */
  callLogId?: string | null;
  isTest?: boolean;
  retryOfLogId?: string;
  /** Which automatic attempt this is, counting from 1. */
  attempt?: number;
}

const MAX_STORED_RESPONSE_LENGTH = 5000;

/**
 * Automatic retry schedule, in minutes after each failed attempt.
 *
 * Backs off steeply rather than hammering: an endpoint that just failed is
 * usually down for minutes, not milliseconds, and at ~3,800 recordings a day a
 * tight retry loop against a dead receiver would generate more traffic than the
 * CRM's own users. Five attempts spans just over four hours, which covers a
 * deploy or a short outage without chasing a permanently dead URL forever.
 *
 * Nothing is retried past the last entry — the delivery stays failed and
 * visible in the log, where a human can press Retry if it is worth it.
 */
const RETRY_DELAYS_MINUTES = [1, 5, 15, 60, 180];
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_MINUTES.length + 1;

/**
 * When to try again, or null to stop.
 *
 * Only real deliveries are rescheduled. A Test & Send is a human pressing a
 * button to see what happens, so retrying it behind their back would send a
 * request they did not ask for and did not watch.
 */
function nextRetryFor(attempt: number, isTest: boolean, success: boolean): Date | null {
  if (success || isTest) return null;
  const delay = RETRY_DELAYS_MINUTES[attempt - 1];
  if (delay === undefined) return null;
  return new Date(Date.now() + delay * 60_000);
}

/** Never send a decrypted secret header value back to the browser — mask it with a stable sentinel the save flow recognizes as "unchanged". */
export function sanitizeHeadersForClient(headers: IntegrationHeader[]): IntegrationHeader[] {
  return headers.map((h) => (h.isSecret ? { ...h, value: SECRET_UNCHANGED_SENTINEL } : h));
}

/**
 * Prepares a header list from the client for storage: plain values pass
 * through, secret values are encrypted — unless the client echoed back the
 * "unchanged" sentinel (the admin didn't touch that field), in which case
 * the existing encrypted value at the same position is kept as-is.
 */
export function prepareHeadersForStorage(
  headers: IntegrationHeader[],
  existingHeaders: IntegrationHeader[] = []
): IntegrationHeader[] {
  return headers.map((h, i) => {
    if (!h.isSecret) return h;
    if (h.value === SECRET_UNCHANGED_SENTINEL) {
      return { ...h, value: existingHeaders[i]?.isSecret ? existingHeaders[i].value : encryptSecret('') };
    }
    return { ...h, value: encryptSecret(h.value) };
  });
}

/**
 * Fans out a lead to every active integration configured for `trigger`.
 * Fire-and-forget from the caller's perspective (never throws) — this app
 * has no job queue, and it runs on a persistent PM2 Node process (not
 * serverless), so a call kicked off without `await` right before an API
 * route returns keeps running in the background after the response is
 * sent. A slow/down third-party API therefore never delays or breaks the
 * lead-creation flow that triggered it.
 */
export async function pushLeadToIntegrations(
  leadId: string,
  trigger: LeadIntegrationTrigger,
  // Which event is pushing. The trigger picks WHICH integrations fire; this
  // says WHY, so the body can differ between a referral and a preferences
  // update that share one integration. Defaults to REFERRAL so existing
  // callers are unchanged.
  source: PushSource = 'REFERRAL',
): Promise<void> {
  try {
    const integrations = await prisma.leadIntegration.findMany({ where: { trigger, isActive: true } });
    if (integrations.length === 0) return;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        profile: true,
        referredBy: { select: { name: true } },
        assignedTo: { select: { id: true, name: true, email: true, employeeCode: true, dialshreeId: true } },
      },
    });
    if (!lead) return;

    const data = await buildLeadTemplateData(lead, source);
    await Promise.all(
      integrations.map((integration) => executeIntegration(integration, data, { leadId, isTest: false }))
    );
  } catch (err) {
    console.error('[lead-integration-engine] pushLeadToIntegrations failed', err);
  }
}

/**
 * Pushes a stored recording to every active RECORDING_RECEIVED integration.
 *
 * Fired from the dialer's post-call webhook once the CallLog is written. Like
 * pushLeadToIntegrations it swallows its own errors and is called without
 * `await`, so a slow analytics endpoint can never delay or fail the webhook —
 * the dialer would retry a non-200 and duplicate the call record.
 *
 * Skips calls with no recording: the whole payload is about the audio, and a
 * delivery the receiver can only reject is noise in the logs.
 */
export async function pushRecordingToIntegrations(callLogId: string): Promise<void> {
  try {
    const integrations = await prisma.leadIntegration.findMany({
      where: { trigger: 'RECORDING_RECEIVED', isActive: true },
    });
    if (integrations.length === 0) return;

    const call = await prisma.callLog.findUnique({
      where: { id: callLogId },
      include: {
        lead: { include: { profile: true } },
        agent: { select: { id: true, name: true, email: true, employeeCode: true, dialshreeId: true, teamId: true } },
      },
    });
    if (!call || !call.recordingUrl) return;

    const data = await buildCallTemplateData(call);
    await Promise.all(
      integrations.map((integration) =>
        executeIntegration(integration, data, { leadId: call.leadId, callLogId: call.id, isTest: false }),
      ),
    );
  } catch (err) {
    console.error('[lead-integration-engine] pushRecordingToIntegrations failed', err);
  }
}

/**
 * Renders and sends one integration's request, and always writes a
 * LeadIntegrationLog row (success or failure) so pushes are auditable.
 * Used for real triggered pushes, manual "Test & Send", and retries.
 */
export async function executeIntegration(
  integration: LeadIntegration,
  data: Record<string, unknown>,
  options: ExecuteOptions = {}
): Promise<ExecuteResult> {
  const baseLog = {
    integrationId: integration.id,
    leadId: options.leadId ?? null,
    callLogId: options.callLogId ?? null,
    isTest: options.isTest ?? false,
    retryOfLogId: options.retryOfLogId ?? null,
    attempt: options.attempt ?? 1,
  };

  let url: URL;
  const renderedHeaders: Record<string, string> = {};
  // Secret header values are never written back to the log in plaintext —
  // that would silently undermine encrypting them at rest in the config.
  const logHeaders: Record<string, string> = {};

  try {
    const headers = ((integration.headers as unknown as IntegrationHeader[]) ?? []).filter((h) => h.key);
    const params = ((integration.queryParams as unknown as IntegrationParam[]) ?? []).filter((p) => p.key);

    for (const h of headers) {
      const plain = h.isSecret ? decryptSecret(h.value) : h.value;
      const finalValue = renderText(plain, data);
      renderedHeaders[h.key] = finalValue;
      logHeaders[h.key] = h.isSecret ? maskSecret() : finalValue;
    }

    url = new URL(renderText(integration.url, data));
    for (const p of params) {
      url.searchParams.set(renderText(p.key, data), renderText(p.value, data));
    }
  } catch (err) {
    const errorMessage = `Failed to build request: ${err instanceof Error ? err.message : 'Unknown error'}`;
    await prisma.leadIntegrationLog
      .create({
        data: {
          ...baseLog,
          requestUrl: integration.url,
          requestMethod: integration.method,
          requestHeaders: logHeaders as Prisma.InputJsonValue,
          requestBody: '',
          success: false,
          errorMessage,
        },
      })
      .catch((logErr) => console.error('[lead-integration-engine] failed to write log', logErr));
    return { success: false, responseStatus: null, responseBody: null, errorMessage };
  }

  const { output: renderedBody, valid, error: bodyError } = renderTemplate(integration.bodyTemplate, data);

  const logShared = {
    ...baseLog,
    requestUrl: url.toString(),
    requestMethod: integration.method,
    requestHeaders: logHeaders as Prisma.InputJsonValue,
    requestBody: renderedBody,
  };

  if (!valid) {
    const errorMessage = `Body template did not render to valid JSON: ${bodyError}`;
    await prisma.leadIntegrationLog
      .create({ data: { ...logShared, success: false, errorMessage } })
      .catch((logErr) => console.error('[lead-integration-engine] failed to write log', logErr));
    return { success: false, responseStatus: null, responseBody: null, errorMessage };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), integration.timeoutMs);
  let result: ExecuteResult;
  try {
    const method = integration.method.toUpperCase();
    const res = await fetch(url.toString(), {
      method,
      headers: renderedHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : renderedBody,
      signal: controller.signal,
    });
    const text = await res.text();
    const truncated =
      text.length > MAX_STORED_RESPONSE_LENGTH ? `${text.slice(0, MAX_STORED_RESPONSE_LENGTH)}…` : text;
    result = {
      success: res.ok,
      responseStatus: res.status,
      responseBody: truncated,
      errorMessage: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const isAbort = err instanceof Error && err.name === 'AbortError';
    result = {
      success: false,
      responseStatus: null,
      responseBody: null,
      errorMessage: isAbort
        ? `Request timed out after ${integration.timeoutMs}ms`
        : err instanceof Error
        ? err.message
        : 'Unknown error',
    };
  } finally {
    clearTimeout(timeout);
  }

  await prisma.leadIntegrationLog
    .create({
      data: {
        ...logShared,
        responseStatus: result.responseStatus,
        responseBody: result.responseBody,
        success: result.success,
        errorMessage: result.errorMessage,
        // The sweeper's whole queue is "rows with a nextRetryAt in the past",
        // so scheduling the next attempt IS writing this field.
        nextRetryAt: nextRetryFor(baseLog.attempt, baseLog.isTest, result.success),
      },
    })
    .catch((logErr) => console.error('[lead-integration-engine] failed to write log', logErr));

  return result;
}
