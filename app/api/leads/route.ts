import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { nonFeedbackQuerySchema, buildNonFeedbackFilters, buildFeedbackFilter } from '@/lib/lead-query-filters';
import { Feature } from '@prisma/client';

const singleLeadSchema = z.object({
  name:        z.string().min(1, 'Name is required'),
  email:       z.string().email('Invalid email'),
  phone:       z.string().min(1, 'Phone is required'),
  college:     z.string().min(1, 'College is required'),
  city:        z.string().optional().nullable(),
  state:       z.string().optional().nullable(),
  course:      z.string().optional().nullable(),
  campaign:    z.string().optional().nullable(),
  leadType:    z.string().optional().nullable(),
  leadOrigin:  z.string().optional().nullable(),
  leadZone:    z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canUpload = await hasPermission(session.user.role, Feature.UPLOAD_LEADS);
  if (!canUpload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json();
  const parsed = singleLeadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const d = parsed.data;
  try {
    const email   = d.email.trim().toLowerCase();
    const college = d.college?.trim() || null;

    // Duplicate = same email AND same college (null == null)
    const existing = await prisma.lead.findFirst({
      where: {
        email,
        college: college ? { equals: college, mode: 'insensitive' } : null,
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'A lead with this email and college already exists' },
        { status: 409 },
      );
    }

    const lead = await prisma.lead.create({
      data: {
        // Not @updatedAt any more (see schema.prisma) — a new lead reads as
        // its creation time until the first feedback advances it.
        updatedAt:   new Date(),
        name:        d.name.trim(),
        email,
        phone:       d.phone.trim(),
        city:        d.city?.trim()       || null,
        state:       d.state?.trim()      || null,
        course:      d.course?.trim()     || null,
        college,
        campaign:    d.campaign?.trim()   || null,
        leadType:    d.leadType?.trim()   || null,
        leadOrigin:  d.leadOrigin?.trim() || null,
        leadZone:    d.leadZone?.trim()   || null,
        status:      'PENDING',
        uploadedById: session.user.id,
      },
    });
    return NextResponse.json(lead, { status: 201 });
  } catch (err: unknown) {
    console.error('[leads POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const querySchema = nonFeedbackQuerySchema.extend({
  feedbackTab:         z.enum(['all', 'fresh', 'interested', 'followup', 'not_interested']).optional(),
  feedbackOptionIds:   z.string().optional(),
  feedbackCategoryIds: z.string().optional(),   // comma-separated FeedbackCategory IDs
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

  const [canView, canReport] = await Promise.all([
    hasPermission(session.user.role, Feature.VIEW_LEADS),
    hasPermission(session.user.role, Feature.VIEW_REPORTS),
  ]);
  if (!canView && !canReport) {
    return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const { feedbackTab, feedbackOptionIds, feedbackCategoryIds, page, limit } = parsed.data;

  const skip = (page - 1) * limit;

  const accessClause = getLeadWhereClause({ id: session.user.id, role: session.user.role });
  const filters = buildNonFeedbackFilters(parsed.data, session.user);

  if (feedbackTab && feedbackTab !== 'all') {
    if (feedbackTab === 'fresh')        filters.push({ feedbacks: { none: {} } });
    if (feedbackTab === 'followup')     filters.push({ feedbacks: { some: {} } });
    if (feedbackTab === 'interested')   filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'interested',     mode: 'insensitive' } } } } });
    if (feedbackTab === 'not_interested') filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'not interested', mode: 'insensitive' } } } } });
  }
  const feedbackFilter = await buildFeedbackFilter(prisma, feedbackOptionIds, feedbackCategoryIds);
  if (feedbackFilter) filters.push(feedbackFilter);

  const where = filters.length > 0 ? { AND: [accessClause, ...filters] } : accessClause;

  try {
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take: limit,
        orderBy: ['COUNSELLING_AGENT', 'COUNSELLING_TL'].includes(session.user.role)
          ? [{ assignedAt: 'desc' as const }, { createdAt: 'desc' as const }, { id: 'asc' as const }]
          : [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
        include: {
          uploadedBy:    { select: { id: true, name: true } },
          approvedBy:    { select: { id: true, name: true } },
          disapprovedBy: { select: { id: true, name: true } },
          assignedTo:    { select: { id: true, name: true } },
          assignedBy:    { select: { id: true, name: true } },
          assignedFrom:  { select: { id: true, name: true } },
          prevAssignee2: { select: { id: true, name: true } },
          batch:         { select: { id: true, fileName: true, createdAt: true } },
          feedbacks:     { take: 1, orderBy: { followUpNumber: 'desc' }, select: { followUpNumber: true, feedbackOption: { select: { label: true } } } },
          _count:        { select: { feedbacks: true } },
          profile:       true,
        },
      }),
      prisma.lead.count({ where }),
    ]);

    return NextResponse.json({ leads, total, page, limit, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    console.error('[leads GET]', err);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
