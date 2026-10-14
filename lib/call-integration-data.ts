import type { CallLog, Lead, LeadProfile, User } from '@prisma/client';
import { buildLeadTemplateData, type LeadForTemplate } from '@/lib/lead-integration-data';

/**
 * The template data for a RECORDING_RECEIVED push.
 *
 * Built on top of the lead fields rather than beside them, so a recording
 * webhook can reference everything a referral webhook can — the analytics tool
 * wants the lead's name and campaign alongside the audio, and duplicating those
 * mappings would be a second place for them to drift.
 *
 * **A call need not have a lead.** On production roughly half of all call logs
 * match none — inbound numbers nobody has in the CRM — and those are exactly
 * the missed calls worth analysing. So every lead-derived field degrades to
 * null rather than the push being skipped, and `lead_matched` says which case
 * the receiver is looking at instead of leaving them to infer it from blanks.
 */
export type CallForTemplate = CallLog & {
  lead?: (Lead & { profile?: LeadProfile | null }) | null;
  agent?: Pick<User, 'id' | 'name' | 'email' | 'employeeCode' | 'dialshreeId' | 'teamId'> | null;
};

export async function buildCallTemplateData(call: CallForTemplate): Promise<Record<string, unknown>> {
  // Lead fields when there is a lead; the same keys present and null when there
  // is not, so a template referencing {{name}} renders "" rather than exploding
  // on half the traffic.
  const leadData = call.lead
    ? await buildLeadTemplateData(call.lead as LeadForTemplate, 'REFERRAL')
    : {};

  return {
    ...leadData,

    // ── Recording ──────────────────────────────────────────────────────────
    /**
     * The dialer's own URL, passed through unchanged.
     *
     * Chosen deliberately over a signed CRM link: the receiving tool can fetch
     * it with no credentials. The cost, accepted knowingly, is that the URL
     * contains the student's phone number in its path and never expires — see
     * the note on the proxy in app/api/leads/[id]/calls/[callId]/recording.
     */
    recording_url: call.recordingUrl,
    recording_id: call.uniqueId ?? call.id,
    recording_available: Boolean(call.recordingUrl),

    // ── Call ───────────────────────────────────────────────────────────────
    call_id: call.id,
    call_unique_id: call.uniqueId,
    call_status: call.callStatus,
    call_connected: call.connected,
    call_type: call.callType,
    call_term_reason: call.termReason,
    call_disposition: call.dispositionDescription,
    /** Seconds. Talk time is the one to analyse; duration includes ringing. */
    call_duration_seconds: call.durationSeconds,
    call_talk_time_seconds: call.talkTimeSeconds,
    call_ring_time_seconds: call.ringTimeSeconds,
    call_started_at: call.startedAt?.toISOString() ?? null,
    call_ended_at: call.endedAt?.toISOString() ?? null,
    call_phone_number: call.phoneNumber,
    call_campaign: call.campaign,

    // ── Lead linkage ───────────────────────────────────────────────────────
    /** False for the ~50% of calls that match no lead — see the note above. */
    lead_matched: Boolean(call.leadId),
    lead_id: call.leadId,

    // ── Agent ──────────────────────────────────────────────────────────────
    // From the CRM user where the dialer's seat is mapped, falling back to the
    // raw strings the dialer sent. A seat with no mapped user still identifies
    // who was on the call, which is better than sending nothing.
    agent_id: call.agent?.id ?? null,
    agent_name: call.agent?.name ?? call.agentFullName ?? null,
    agent_email: call.agent?.email ?? call.agentEmail ?? null,
    agent_employee_code: call.agent?.employeeCode ?? null,
    agent_team_id: call.agent?.teamId ?? null,
    agent_seat: call.agentSeat,
    agent_dialshree_id: call.agent?.dialshreeId ?? null,

    // ── Event metadata ─────────────────────────────────────────────────────
    /**
     * Stable per call, not per attempt: a retry of the same recording carries
     * the same event_id, so the receiver can discard a duplicate it already
     * analysed instead of scoring the call twice.
     */
    event_id: `rec_${call.id}`,
    event_type: 'RECORDING_RECEIVED',
    event_timestamp: new Date().toISOString(),
    call_received_at: call.receivedAt.toISOString(),
  };
}
