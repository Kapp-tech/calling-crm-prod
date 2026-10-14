import { prisma } from '@/lib/prisma';
import { executeIntegration, type ExecuteResult } from '@/lib/lead-integration-engine';
import { buildLeadTemplateData } from '@/lib/lead-integration-data';
import { buildCallTemplateData } from '@/lib/call-integration-data';

/**
 * Sending one past delivery again, from its log row.
 *
 * Shared by the manual Retry button and the automatic sweeper so the two cannot
 * drift. They want the same thing — rebuild the payload from whatever the
 * delivery was about and send it through the same engine — and the only
 * difference is who asked.
 *
 * The payload is REBUILT, never replayed from the stored request body. A
 * recording whose lead was matched after the first attempt should go out
 * correctly on the second; replaying the old bytes would resend the gap.
 */

export type RedeliveryOutcome =
  | { ok: true; result: ExecuteResult }
  | { ok: false; reason: string };

export async function redeliverLog(logId: string): Promise<RedeliveryOutcome> {
  const log = await prisma.leadIntegrationLog.findUnique({ where: { id: logId } });
  if (!log) return { ok: false, reason: 'Log entry not found' };

  const integration = await prisma.leadIntegration.findUnique({ where: { id: log.integrationId } });
  if (!integration) return { ok: false, reason: 'Integration no longer exists' };
  if (!integration.isActive) return { ok: false, reason: 'Integration is disabled' };

  const attempt = log.attempt + 1;

  // A recording delivery is identified by its call, not its lead — half of all
  // calls have no lead at all, so this must be checked first.
  if (log.callLogId) {
    const call = await prisma.callLog.findUnique({
      where: { id: log.callLogId },
      include: {
        lead: { include: { profile: true } },
        agent: { select: { id: true, name: true, email: true, employeeCode: true, dialshreeId: true, teamId: true } },
      },
    });
    if (!call) return { ok: false, reason: 'The original call no longer exists' };

    const data = await buildCallTemplateData(call);
    const result = await executeIntegration(integration, data, {
      leadId: call.leadId,
      callLogId: call.id,
      isTest: log.isTest,
      retryOfLogId: log.id,
      attempt,
    });
    return { ok: true, result };
  }

  if (!log.leadId) {
    return { ok: false, reason: 'This attempt used synthetic sample data and cannot be retried' };
  }

  const lead = await prisma.lead.findUnique({
    where: { id: log.leadId },
    include: {
      profile: true,
      referredBy: { select: { name: true } },
      assignedTo: { select: { id: true, name: true, email: true, employeeCode: true, dialshreeId: true } },
    },
  });
  if (!lead) return { ok: false, reason: 'The original lead no longer exists' };

  const data = await buildLeadTemplateData(lead);
  const result = await executeIntegration(integration, data, {
    leadId: lead.id,
    isTest: log.isTest,
    retryOfLogId: log.id,
    attempt,
  });
  return { ok: true, result };
}

/**
 * Clears a log's retry schedule so the sweeper stops considering it.
 *
 * Called when a redelivery is impossible rather than merely failed — a deleted
 * call, a disabled integration. Without this the sweeper would pick the same
 * doomed row up every minute forever.
 */
export async function abandonRetry(logId: string, reason: string): Promise<void> {
  await prisma.leadIntegrationLog.update({
    where: { id: logId },
    data: { nextRetryAt: null, errorMessage: `Retry abandoned: ${reason}` },
  });
}
