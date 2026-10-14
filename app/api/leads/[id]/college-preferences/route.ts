import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';
import { logActivity } from '@/lib/permissions';
import { pushLeadToIntegrations } from '@/lib/lead-integration-engine';
import { MAX_COLLEGE_PREFERENCES } from '@/lib/college-attributes';

/**
 * The student's college shortlist: save it, then push the lead onward in one go.
 *
 * Stored on LeadProfile.preferredCollegeIds, which already existed for the Lead
 * Profile wizard — this is the same field, reachable from the lead drawer so a
 * counsellor can capture a shortlist mid-call without leaving the conversation.
 *
 * The ids are LMS `college_id` values, which are the same numbers as a KAPP
 * College ID (LPU is 7042725 in both). So no mapping is needed between what the
 * picker shows and what the LMS is sent.
 *
 * Why REFERRAL_CREATED rather than a trigger of its own: that enum has a single
 * value today, and the "CRM to LMS" integration row is configured against it.
 * Adding a value would mean an enum migration AND a second integration row
 * duplicating the same endpoint, headers and secret — when the requirement is
 * explicitly to push through the SAME API. So the trigger is read here as
 * "the LMS lead push", which is what the one row configured against it does.
 * The name is now narrower than the meaning; renaming it is a migration for the
 * day a second integration genuinely needs separating.
 */

const schema = z.object({
  // Numeric ids only. The picker supplies them, but this endpoint is reachable
  // directly, and a non-numeric id would be sent to the LMS verbatim.
  collegeIds: z
    .array(z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]))
    .max(MAX_COLLEGE_PREFERENCES, `At most ${MAX_COLLEGE_PREFERENCES} colleges`)
    .transform((v) => v.map((x) => Number(x))),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!(await canAccessLead(session.user, params.id))) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const parsed = schema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
    }

    // De-duplicated, order preserved: a counsellor ticking the same college
    // twice should not send it twice, and the order is the order they chose.
    const collegeIds = Array.from(new Set(parsed.data.collegeIds));

    await prisma.leadProfile.upsert({
      where: { leadId: params.id },
      create: { leadId: params.id, preferredCollegeIds: collegeIds },
      update: { preferredCollegeIds: collegeIds },
    });

    await logActivity({
      userId: session.user.id,
      action: 'LEAD_ASSIGNED',
      targetId: params.id,
      targetType: 'Lead',
      description: `College preferences saved (${collegeIds.length} college(s))`,
      metadata: { collegeIds },
    });

    /**
     * Saved first, pushed second, and the push is awaited but never fatal.
     *
     * The shortlist is the counsellor's work and must survive a bad gateway;
     * the push is a copy of it going elsewhere. pushLeadToIntegrations already
     * records every attempt and its error on LeadIntegrationLog, which is what
     * the drawer shows, so a failure here is visible rather than silent — and
     * the save is not rolled back because the far end was down.
     */
    await pushLeadToIntegrations(params.id, 'REFERRAL_CREATED', 'COLLEGE_PREFERENCES');

    return NextResponse.json({ success: true, collegeIds });
  } catch (error) {
    console.error('[college-preferences POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
