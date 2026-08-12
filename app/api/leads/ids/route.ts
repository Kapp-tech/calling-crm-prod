import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { istStartOfDay, istEndOfDay } from '@/lib/ist-time';
import { parseCsvFilterValues as split } from '@/lib/csv-filter-value';
import { Feature, LeadStatus } from '@prisma/client';

const querySchema = z.object({
  status:            z.nativeEnum(LeadStatus).optional(),
  assignedToId:      z.string().optional(),
  search:            z.string().optional(),
  zone:              z.string().optional(),
  city:              z.string().optional(),
  state:             z.string().optional(),
  course:            z.string().optional(),
  college:           z.string().optional(),
  campaign:          z.string().optional(),
  leadType:          z.string().optional(),
  leadOrigin:        z.string().optional(),
  tlId:              z.string().optional(),
  assignmentStatus:  z.enum(['all', 'unassigned', 'assigned']).optional(),
  dateFrom:          z.string().optional(),
  dateTo:            z.string().optional(),
  feedbackTab:       z.enum(['all', 'fresh', 'interested', 'followup', 'not_interested']).optional(),
  feedbackOptionIds: z.string().optional(),
  skip:              z.coerce.number().min(0).optional(),
  limit:             z.coerce.number().min(1).max(10000).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canAssign = await hasPermission(session.user.role, Feature.ASSIGN_LEADS);
  if (!canAssign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    status, assignedToId, search,
    zone, city, state, course, college,
    campaign, leadType, leadOrigin, tlId,
    assignmentStatus, dateFrom, dateTo, feedbackTab, feedbackOptionIds,
    skip, limit,
  } = parsed.data;

  const cities      = split(city);
  const states      = split(state);
  const courses     = split(course);
  const colleges    = split(college);
  const campaigns   = split(campaign);
  const leadTypes   = split(leadType);
  const leadOrigins = split(leadOrigin);
  const zones       = split(zone);
  const tlIds       = split(tlId);
  const agentIds    = split(assignedToId);

  const accessClause = getLeadWhereClause({ id: session.user.id, role: session.user.role });
  const filters: Record<string, unknown>[] = [];

  if (status)                    filters.push({ status });
  if (agentIds.length > 0)       filters.push({ assignedToId: { in: agentIds } });
  if (assignmentStatus === 'unassigned') filters.push({ assignedToId: null });
  if (assignmentStatus === 'assigned')   filters.push({ assignedToId: { not: null } });
  if (search) {
    filters.push({
      OR: [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
        { city:  { contains: search, mode: 'insensitive' } },
      ],
    });
  }
  if (cities.length > 0)      filters.push({ city:      { in: cities,      mode: 'insensitive' } });
  if (states.length > 0)      filters.push({ state:     { in: states,      mode: 'insensitive' } });
  if (courses.length > 0)     filters.push({ course:    { in: courses,     mode: 'insensitive' } });
  if (colleges.length > 0)    filters.push({ college:   { in: colleges,    mode: 'insensitive' } });
  if (campaigns.length > 0)   filters.push({ campaign:  { in: campaigns,   mode: 'insensitive' } });
  if (leadTypes.length > 0)   filters.push({ leadType:  { in: leadTypes,   mode: 'insensitive' } });
  if (leadOrigins.length > 0) filters.push({ leadOrigin:{ in: leadOrigins, mode: 'insensitive' } });
  if (zones.length > 0)       filters.push({ leadZone:  { in: zones,       mode: 'insensitive' } });
  if (tlIds.length > 0)       filters.push({ team: { teamLeadId: { in: tlIds } } });
  // IST calendar-day bounds — see lib/ist-time.ts.
  if (dateFrom) filters.push({ createdAt: { gte: istStartOfDay(dateFrom) } });
  if (dateTo) filters.push({ createdAt: { lte: istEndOfDay(dateTo) } });
  if (feedbackTab && feedbackTab !== 'all') {
    if (feedbackTab === 'fresh')          filters.push({ feedbacks: { none: {} } });
    if (feedbackTab === 'followup')       filters.push({ feedbacks: { some: {} } });
    if (feedbackTab === 'interested')     filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'interested',     mode: 'insensitive' } } } } });
    if (feedbackTab === 'not_interested') filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'not interested', mode: 'insensitive' } } } } });
  }
  if (feedbackOptionIds) {
    const ids = split(feedbackOptionIds);
    if (ids.length > 0) filters.push({ currentFeedbackOptionId: { in: ids } });
  }

  const where = filters.length > 0 ? { AND: [accessClause, ...filters] } : accessClause;

  try {
    const orderBy = ['COUNSELLING_AGENT', 'COUNSELLING_TL'].includes(session.user.role)
      ? [{ assignedAt: 'desc' as const }, { createdAt: 'desc' as const }, { id: 'asc' as const }]
      : [{ createdAt: 'desc' as const }, { id: 'asc' as const }];

    const leads = await prisma.lead.findMany({
      where,
      select: { id: true },
      skip: skip ?? 0,
      take: limit ?? 10000,
      orderBy,
    });
    return NextResponse.json({ ids: leads.map((l) => l.id), total: leads.length });
  } catch (err) {
    console.error('[leads/ids GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
