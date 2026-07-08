import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const approved = { status: 'APPROVED' as const };

    const [
      campaigns, leadTypes, leadOrigins, leadZones, cities, states, colleges, courses,
      leadConfirmations, leadVerifications, dataCallingTypes,
      primaryAppConfirms, primaryAdmConfirms, leadStages,
    ] = await Promise.all([
      prisma.lead.findMany({ distinct: ['campaign'],                    where: { ...approved, campaign:                    { not: null } }, select: { campaign:                    true }, orderBy: { campaign:                    'asc' } }),
      prisma.lead.findMany({ distinct: ['leadType'],                    where: { ...approved, leadType:                    { not: null } }, select: { leadType:                    true }, orderBy: { leadType:                    'asc' } }),
      prisma.lead.findMany({ distinct: ['leadOrigin'],                  where: { ...approved, leadOrigin:                  { not: null } }, select: { leadOrigin:                  true }, orderBy: { leadOrigin:                  'asc' } }),
      prisma.lead.findMany({ distinct: ['leadZone'],                    where: { ...approved, leadZone:                    { not: null } }, select: { leadZone:                    true }, orderBy: { leadZone:                    'asc' } }),
      prisma.lead.findMany({ distinct: ['city'],                        where: { ...approved, city:                        { not: null } }, select: { city:                        true }, orderBy: { city:                        'asc' } }),
      prisma.lead.findMany({ distinct: ['state'],                       where: { ...approved, state:                       { not: null } }, select: { state:                       true }, orderBy: { state:                       'asc' } }),
      prisma.lead.findMany({ distinct: ['college'],                     where: { ...approved, college:                     { not: null } }, select: { college:                     true }, orderBy: { college:                     'asc' } }),
      prisma.lead.findMany({ distinct: ['course'],                      where: { ...approved, course:                      { not: null } }, select: { course:                      true }, orderBy: { course:                      'asc' } }),
      prisma.lead.findMany({ distinct: ['leadConfirmation'],            where: { ...approved, leadConfirmation:            { not: null } }, select: { leadConfirmation:            true }, orderBy: { leadConfirmation:            'asc' } }),
      prisma.lead.findMany({ distinct: ['leadVerification'],            where: { ...approved, leadVerification:            { not: null } }, select: { leadVerification:            true }, orderBy: { leadVerification:            'asc' } }),
      prisma.lead.findMany({ distinct: ['dataCallingType'],             where: { ...approved, dataCallingType:             { not: null } }, select: { dataCallingType:             true }, orderBy: { dataCallingType:             'asc' } }),
      prisma.lead.findMany({ distinct: ['primaryApplicationConfirm'],  where: { ...approved, primaryApplicationConfirm:  { not: null } }, select: { primaryApplicationConfirm:  true }, orderBy: { primaryApplicationConfirm:  'asc' } }),
      prisma.lead.findMany({ distinct: ['primaryAdmissionConfirm'],    where: { ...approved, primaryAdmissionConfirm:    { not: null } }, select: { primaryAdmissionConfirm:    true }, orderBy: { primaryAdmissionConfirm:    'asc' } }),
      prisma.lead.findMany({ distinct: ['leadStage'],                   where: { ...approved, leadStage:                   { not: null } }, select: { leadStage:                   true }, orderBy: { leadStage:                   'asc' } }),
    ]);

    return NextResponse.json({
      campaigns:            campaigns.map((r) => r.campaign!),
      leadTypes:            leadTypes.map((r) => r.leadType!),
      leadOrigins:          leadOrigins.map((r) => r.leadOrigin!),
      leadZones:            leadZones.map((r) => r.leadZone!),
      cities:               cities.map((r) => r.city!),
      states:               states.map((r) => r.state!),
      colleges:             colleges.map((r) => r.college!),
      courses:              courses.map((r) => r.course!),
      leadConfirmations:    leadConfirmations.map((r) => r.leadConfirmation!),
      leadVerifications:    leadVerifications.map((r) => r.leadVerification!),
      dataCallingTypes:     dataCallingTypes.map((r) => r.dataCallingType!),
      primaryAppConfirms:   primaryAppConfirms.map((r) => r.primaryApplicationConfirm!),
      primaryAdmConfirms:   primaryAdmConfirms.map((r) => r.primaryAdmissionConfirm!),
      leadStages:           leadStages.map((r) => r.leadStage!),
    });
  } catch (error) {
    console.error('[leads/filter-options GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
