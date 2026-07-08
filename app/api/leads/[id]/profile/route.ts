import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';

// Profiles are filled in by counsellors — reports/operations only view leads.
const PROFILE_EDIT_ROLES = ['SUPER_ADMIN', 'COUNSELLING_TL', 'COUNSELLING_AGENT'];

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!PROFILE_EDIT_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const body = await req.json();

    // Each step of the Lead Profile wizard saves to this same endpoint, but only
    // sends the fields it owns — only touch keys actually present in the body so
    // one step's save can't null out another step's previously saved fields.
    const ALLOWED_FIELDS = [
      'budget', 'preferredCourseIds', 'preferredCollegeIds',
      'preferredCityNames', 'preferredStateNames',
      'courseType', 'collegeType', 'specialisation', 'entranceExam',
      'scholarshipAwareness', 'loanRequirement', 'loanAmount', 'paymentModePreference',
      'stayPreference', 'monthlyAccommodationBudget', 'roomSharing', 'mealsPreference',
      'keyAmenities', 'distanceWillingness', 'genderHostelRequirement',
      'class10Percentage', 'class12Percentage', 'board', 'gapYearReason', 'mediumOfInstruction',
    ] as const;

    const data: Record<string, unknown> = {};
    for (const key of ALLOWED_FIELDS) {
      if (key in body) data[key] = body[key] ?? null;
    }

    const profile = await prisma.leadProfile.upsert({
      where: { leadId: params.id },
      create: { leadId: params.id, ...data },
      update: data,
    });

    return NextResponse.json(profile);
  } catch (error) {
    console.error('[leads/[id]/profile PUT]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
