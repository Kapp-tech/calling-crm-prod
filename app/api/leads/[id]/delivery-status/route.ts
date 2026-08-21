import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';
import { fetchLmsDeliveryStatus } from '@/lib/lms-api';
import { resolveCityId, resolveStateId } from '@/lib/lms-location-lookup';
import { resolveCourseGroupId } from '@/lib/lms-course-lookup';

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
      select: {
        id: true, phone: true, email: true, kappCollegeId: true,
        city: true, state: true, course: true,
        assignedTo: { select: { employeeCode: true } },
      },
    });
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    // The endpoint requires all seven fields, so the CRM's names have to be
    // resolved to the LMS's own ids. These lookups are cached for an hour by the
    // same helpers the lead-integration push uses, so the values sent here match
    // the values that were delivered.
    const [courseId, cityId, stateId] = await Promise.all([
      resolveCourseGroupId(lead.course),
      resolveCityId(lead.city),
      resolveStateId(lead.state),
    ]);

    const result = await fetchLmsDeliveryStatus({
      kaapId: lead.kappCollegeId,
      email: lead.email,
      phone: lead.phone,
      courseId,
      cityId,
      stateId,
      // The numeric part of the employee code — the same value the integration
      // template sends as counsellor_id via {{digits(assignedTo_employeeCode)}}.
      counsellorId: (lead.assignedTo?.employeeCode ?? '').replace(/\D+/g, '') || null,
    });

    if (!result.found || !result.log) {
      // A rejected request is not the same claim as an undelivered lead. Saying
      // "no delivery recorded" for both is what hid this breaking upstream
      // change: the API started demanding all seven parameters and the card
      // reported it as the client simply not having taken the lead.
      const notFound = result.reason === 'NOT_FOUND';
      return NextResponse.json({
        found: false,
        reason: result.reason ?? 'NOT_FOUND',
        message: notFound
          ? 'The LMS has no client delivery recorded for this lead yet'
          : (result.message ?? 'The LMS could not complete the lookup'),
        upstreamMessage: result.message ?? null,
        // Echoed back so a "not found" is diagnosable: every one of these is an
        // AND filter, and one stale value is enough to hide a real delivery.
        queried: {
          kaapId: lead.kappCollegeId, email: lead.email, phone: lead.phone,
          courseId, cityId, stateId,
          counsellorId: (lead.assignedTo?.employeeCode ?? '').replace(/\D+/g, '') || null,
        },
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
