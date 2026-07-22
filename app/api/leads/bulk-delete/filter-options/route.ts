import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

// Distinct filter values for the Bulk Delete Leads tool's dropdowns. Unlike
// /api/leads/filter-options (scoped to APPROVED leads only, since that's all
// the All Leads page ever shows), this deliberately covers EVERY status —
// a mistaken upload is often still PENDING or was DISAPPROVED, and hiding
// its city/college/etc. from the dropdown would make it impossible to find.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Only Super Admin can use this tool' }, { status: 403 });
    }

    const [campaigns, leadTypes, leadOrigins, leadZones, cities, states, colleges, courses] = await Promise.all([
      prisma.lead.findMany({ distinct: ['campaign'],   where: { campaign:   { not: null } }, select: { campaign:   true }, orderBy: { campaign:   'asc' } }),
      prisma.lead.findMany({ distinct: ['leadType'],   where: { leadType:   { not: null } }, select: { leadType:   true }, orderBy: { leadType:   'asc' } }),
      prisma.lead.findMany({ distinct: ['leadOrigin'], where: { leadOrigin: { not: null } }, select: { leadOrigin: true }, orderBy: { leadOrigin: 'asc' } }),
      prisma.lead.findMany({ distinct: ['leadZone'],   where: { leadZone:   { not: null } }, select: { leadZone:   true }, orderBy: { leadZone:   'asc' } }),
      prisma.lead.findMany({ distinct: ['city'],       where: { city:       { not: null } }, select: { city:       true }, orderBy: { city:       'asc' } }),
      prisma.lead.findMany({ distinct: ['state'],      where: { state:      { not: null } }, select: { state:      true }, orderBy: { state:      'asc' } }),
      prisma.lead.findMany({ distinct: ['college'],    where: { college:    { not: null } }, select: { college:    true }, orderBy: { college:    'asc' } }),
      prisma.lead.findMany({ distinct: ['course'],     where: { course:     { not: null } }, select: { course:     true }, orderBy: { course:     'asc' } }),
    ]);

    return NextResponse.json({
      campaigns:   campaigns.map((r) => r.campaign!),
      leadTypes:   leadTypes.map((r) => r.leadType!),
      leadOrigins: leadOrigins.map((r) => r.leadOrigin!),
      leadZones:   leadZones.map((r) => r.leadZone!),
      cities:      cities.map((r) => r.city!),
      states:      states.map((r) => r.state!),
      colleges:    colleges.map((r) => r.college!),
      courses:     courses.map((r) => r.course!),
    });
  } catch (error) {
    console.error('[leads/bulk-delete/filter-options GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
