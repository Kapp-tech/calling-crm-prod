import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { UNSET_SESSION_YEAR } from '@/lib/college-attributes';

/**
 * The dropdown values every filter bar reads — cached in the process.
 *
 * This endpoint is called by All Leads, the dashboard and Assign Leads, and it
 * was measured at **1,480 ms** on 17 Sept: fifteen separate DISTINCT scans of
 * the Lead table, one per dropdown. The same query took 605 ms on 11 Sept — it
 * did not get worse, the table did, going from 74k rows to 95k in six days. At
 * ~6,000 new leads a day it keeps climbing, and every page load paid it again.
 *
 * Cached because the answer barely moves: these are the distinct cities,
 * colleges and lead codes present in the data. A new value appears when a lead
 * arrives carrying one, and a filter list that is a few minutes behind is
 * harmless — the filter still matches every lead, it just might not *offer* a
 * brand-new city for a short while.
 *
 * Process-wide rather than per-user on purpose: the response does not depend on
 * the session at all. The session is checked for authorisation and then ignored,
 * so every caller gets identical bytes and one cache serves them all.
 *
 * The single-flight guard matters as much as the TTL. Without it, the four
 * requests a cold dashboard fires would each start their own fifteen scans —
 * four times the work, at the exact moment the box is busiest. Sharing the
 * in-flight promise means the first caller does the work and the rest wait on
 * it.
 *
 * Deliberately in-memory, not Next's data cache: pm2 runs one fork of this app,
 * so a module-level value is genuinely shared, and a restart clears it — which
 * is the behaviour wanted after a bulk upload introduces new values.
 */
const FILTER_OPTIONS_TTL_MS = 5 * 60 * 1000;

let cachedOptions: { at: number; payload: unknown } | null = null;
let optionsInFlight: Promise<unknown> | null = null;

/*
 * No exported invalidate hook: a Next route file may only export route handlers,
 * and the five-minute TTL covers the case it would serve anyway — after a bulk
 * upload introduces new colleges or cities, the lists catch up within a few
 * minutes on their own. If it ever needs to be immediate, the cache moves to
 * lib/ and the upload route clears it.
 */

async function loadFilterOptions() {
  {
    const approved = { status: 'APPROVED' as const };

    const [
      campaigns, leadTypes, leadOrigins, leadZones, cities, states, colleges, courses,
      leadConfirmations, leadVerifications, dataCallingTypes,
      primaryAppConfirms, primaryAdmConfirms, leadStages, dealTypes,
      sessionYearRows,
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
      prisma.lead.findMany({ distinct: ['dealType'],                    where: { ...approved, dealType:                    { not: null } }, select: { dealType:                    true }, orderBy: { dealType:                    'asc' } }),
      // Session/Year comes from the COLLEGE list, not from the leads: it is a
      // college attribute read live, so the years on offer are the ones an
      // admin has configured — including ones no lead has reached yet.
      prisma.dropdownOption.findMany({
        // Active only: an inactive row's year never reaches a lead, so
        // offering it would be a filter that always returns nothing.
        where: { type: 'COLLEGE', isActive: true, collegeSessionYear: { not: null } },
        distinct: ['collegeSessionYear'],
        select: { collegeSessionYear: true },
        orderBy: { collegeSessionYear: 'asc' },
      }),
    ]);

    /**
     * "NA" is always offered, because that is what the All Leads column shows
     * for a lead whose college has no year — and a value visible in the table
     * has to be selectable in the filter. It covers a college with the field
     * empty, a lead with no college, and a lead whose college is not in the
     * curated list.
     */
    const sessionYears = [
      ...sessionYearRows.map((r) => r.collegeSessionYear!.trim()).filter(Boolean),
      UNSET_SESSION_YEAR,
    ];

    return {
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
      sessionYears,
      leadStages:           leadStages.map((r) => r.leadStage!),
      dealTypes:            dealTypes.map((r) => r.dealType!),
    };
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const fresh = cachedOptions && Date.now() - cachedOptions.at < FILTER_OPTIONS_TTL_MS;
    if (fresh) return NextResponse.json(cachedOptions!.payload);

    // Share one load between everyone who arrives while it is running.
    if (!optionsInFlight) {
      optionsInFlight = loadFilterOptions().finally(() => { optionsInFlight = null; });
    }
    const payload = await optionsInFlight;
    // Only a successful load is cached; a failure falls through and is retried.
    cachedOptions = { at: Date.now(), payload };
    return NextResponse.json(payload);
  } catch (error) {
    console.error('[leads/filter-options GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
