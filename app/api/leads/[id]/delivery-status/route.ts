import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';
import { fetchLmsDeliveryStatus } from '@/lib/lms-api';

/**
 * What the *client* said about a lead the CRM pushed to the LMS.
 *
 * The CRM's own integration log only proves the LMS accepted the lead ("HTTP
 * 200"). The LMS then forwards it to the client's API, and the client's answer —
 * whether the lead was taken as Primary, rejected, or errored — lives only in
 * the LMS. This reads it back live rather than storing a copy: the outcome
 * changes as the LMS retries, and a stored snapshot would go quietly stale.
 *
 * Access is the same rule as the rest of a lead's data (`canAccessLead`), so a
 * counsellor cannot read the delivery status of a lead they cannot see.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    if (!(await canAccessLead(session.user, params.id))) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const lead = await prisma.lead.findUnique({
      where: { id: params.id },
      select: { id: true, phone: true, kappCollegeId: true },
    });
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    // Phone and college id only. Every extra parameter narrows the upstream
    // match, so sending the lead's current city/course/counsellor would turn a
    // later correction to any of them into a false "not delivered".
    const result = await fetchLmsDeliveryStatus({
      phone: lead.phone,
      kaapId: lead.kappCollegeId,
    });

    if (!result.found || !result.log) {
      // The upstream's own wording ("No delivery log found matching the given
      // parameters") is developer-speak and hides *what* was matched on. Say it
      // in the counsellor's terms and keep the raw text for diagnosis.
      return NextResponse.json({
        found: false,
        message: 'The LMS has no client delivery recorded for this phone and college yet',
        upstreamMessage: result.message ?? null,
      });
    }

    const log = result.log;
    const request = log.request_payload ?? {};

    return NextResponse.json({
      found: true,
      status: log.status,
      // What was *sent* as the confirmation — the "is this lead Primary?"
      // question the LMS answers. Read out of the request payload because the
      // top level does not carry it.
      leadConfirmation: typeof request.leadConfirmation === 'string' ? request.leadConfirmation : null,
      leadCode: log.lead_code,
      clientId: log.client_id,
      lmsLeadId: log.lead_id,
      deliveryLogId: log.delivery_log_id ?? null,
      counsellorId: log.counsellor_id,
      course: log.course_group_name,
      city: log.city_name,
      state: log.state_name,
      responsePayload: log.response_payload,
      requestPayload: log.request_payload,
      createdAt: log.created_at,
      updatedAt: log.updated_at,
    });
  } catch (err) {
    // A timeout or an unreachable LMS is not a CRM fault — say so plainly so the
    // card can show "couldn't reach the LMS" instead of an empty state that
    // reads as "never delivered".
    const message = err instanceof Error ? err.message : 'Could not reach the LMS';
    console.error('[leads/[id]/delivery-status GET]', err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
