import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { Feature, LeadStatus } from '@prisma/client';

function split(v: string | null): string[] {
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

const querySchema = z.object({
  status:           z.nativeEnum(LeadStatus).optional(),
  search:           z.string().optional(),
  city:             z.string().optional(),
  state:            z.string().optional(),
  course:           z.string().optional(),
  college:          z.string().optional(),
  campaign:         z.string().optional(),
  leadType:         z.string().optional(),
  leadOrigin:       z.string().optional(),
  zone:             z.string().optional(),
  tlId:             z.string().optional(),
  assignedToId:     z.string().optional(),
  assignmentStatus: z.enum(['all', 'unassigned', 'assigned']).optional(),
  dateFrom:    z.string().optional(),
  dateTo:      z.string().optional(),
  updatedFrom: z.string().optional(),
  updatedTo:   z.string().optional(),
  feedbackTab:      z.enum(['all', 'fresh', 'interested', 'followup', 'not_interested']).optional(),
  feedbackOptionIds: z.string().optional(),
  feedbackCategoryIds: z.string().optional(),
});

function esc(v: string | null | undefined): string {
  const s = (v ?? '').toString();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return `"${s}"`;
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const [canDownload, canUnmask] = await Promise.all([
      hasPermission(session.user.role, Feature.DOWNLOAD_DATA),
      hasPermission(session.user.role, Feature.MASK_UNMASK_DATA),
    ]);
    if (!canDownload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid params' }, { status: 400 });

    const {
      status, search, city, state, course, college,
      campaign, leadType, leadOrigin, zone, tlId,
      assignedToId, assignmentStatus, dateFrom, dateTo, feedbackTab,
    } = parsed.data;

    const cities      = split(city ?? null);
    const states      = split(state ?? null);
    const courses     = split(course ?? null);
    const colleges    = split(college ?? null);
    const campaigns   = split(campaign ?? null);
    const leadTypes   = split(leadType ?? null);
    const leadOrigins = split(leadOrigin ?? null);
    const zones       = split(zone ?? null);
    const tlIds       = split(tlId ?? null);
    const agentIds    = split(assignedToId ?? null);

    const accessClause = getLeadWhereClause({ id: session.user.id, role: session.user.role });
    const filters: Record<string, unknown>[] = [];

    if (status) filters.push({ status });
    if (agentIds.length > 0) filters.push({ assignedToId: { in: agentIds } });
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
    if (dateFrom) filters.push({ createdAt: { gte: new Date(dateFrom) } });
    if (dateTo) {
      const end = new Date(dateTo);
      end.setHours(23, 59, 59, 999);
      filters.push({ createdAt: { lte: end } });
    }
    if (parsed.data.updatedFrom) filters.push({ updatedAt: { gte: new Date(parsed.data.updatedFrom) } });
    if (parsed.data.updatedTo) {
      const end = new Date(parsed.data.updatedTo);
      end.setHours(23, 59, 59, 999);
      filters.push({ updatedAt: { lte: end } });
    }
    if (feedbackTab && feedbackTab !== 'all') {
      if (feedbackTab === 'fresh')          filters.push({ feedbacks: { none: {} } });
      if (feedbackTab === 'followup')       filters.push({ feedbacks: { some: {} } });
      if (feedbackTab === 'interested')     filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'interested',     mode: 'insensitive' } } } } });
      if (feedbackTab === 'not_interested') filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'not interested', mode: 'insensitive' } } } } });
    }
    {
      const requestedOptionIds = split(parsed.data.feedbackOptionIds ?? null);
      const categoryIds = split(parsed.data.feedbackCategoryIds ?? null);
      const optionIds = new Set(requestedOptionIds);
      if (categoryIds.length > 0) {
        const optionsInCategories = await prisma.feedbackOption.findMany({
          where: { categoryId: { in: categoryIds } },
          select: { id: true },
        });
        for (const o of optionsInCategories) optionIds.add(o.id);
      }
      if (requestedOptionIds.length > 0 || categoryIds.length > 0) {
        filters.push({ currentFeedbackOptionId: { in: Array.from(optionIds) } });
      }
    }

    const where = filters.length > 0 ? { AND: [accessClause, ...filters] } : accessClause;

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id:          true,
        name:        true,
        email:       true,
        phone:       true,
        city:        true,
        state:       true,
        course:      true,
        college:      true,
        kappCollegeId: true,
        campaign:    true,
        leadType:    true,
        leadOrigin:  true,
        leadZone:    true,
        status:      true,
        createdAt:   true,
        updatedAt:   true,
        uploadedAt:  true,
        uploadedBy:  { select: { name: true } },
        assignedTo:  { select: { name: true } },
        assignedBy:  { select: { name: true } },
        assignedFrom:  { select: { name: true } },
        prevAssignee2: { select: { name: true } },
        primaryApplicationConfirm: true,
        primaryAdmissionConfirm:   true,
        leadConfirmation:          true,
        leadStage:                 true,
        leadVerification:          true,
        dataCallingType:           true,
        profile: {
          select: {
            budget:              true,
            courseType:          true,
            collegeType:         true,
            preferredCourseIds:  true,
            preferredCollegeIds: true,
            preferredCityNames:  true,
            preferredStateNames: true,
          },
        },
        feedbacks: {
          orderBy: { followUpNumber: 'asc' },
          select: {
            followUpNumber: true,
            createdAt:      true,
            feedbackOption: { select: { label: true } },
            remarks:        true,
          },
        },
        _count: { select: { feedbacks: true } },
      },
    });

    // ── Build CSV ──────────────────────────────────────────────────────────────

    // Fixed columns
    const fixedHeaders = [
      'Lead ID', 'Name', 'Email', 'Phone',
      'City', 'State', 'Course', 'College', 'KAPP College ID',
      'Lead Code', 'Lead Type', 'Lead Origin', 'Zone',
      'Status', 'Uploaded By',
      'Assigned To', 'Assigned By', 'Assigned From', 'Prev Assignee 2',
      'Updated At', 'Created At', 'Uploaded At',
      'Primary Application Confirm', 'Primary Admission Confirm',
      'Lead Confirmation', 'Lead Stage', 'Lead Verification', 'Data Calling Type',
      'Budget', 'Course Type', 'College Type',
      'Preferred Courses', 'Preferred Colleges', 'Preferred Cities', 'Preferred States',
      'Total Feedbacks',
    ];

    // Dynamic feedback columns — up to max feedbacks seen across all leads
    const maxFeedbacks = leads.reduce((m, l) => Math.max(m, l.feedbacks.length), 0);
    const feedbackHeaders: string[] = [];
    for (let i = 1; i <= maxFeedbacks; i++) {
      feedbackHeaders.push(`Follow-up ${i} Status`, `Follow-up ${i} Remarks`, `Follow-up ${i} Date`);
    }

    const allHeaders = [...fixedHeaders, ...feedbackHeaders];

    const mask = (val: string, type: 'email' | 'phone') => {
      if (canUnmask) return val;
      if (type === 'email') {
        const at = val.indexOf('@');
        return at > 2
          ? `${val.slice(0, 2)}${'*'.repeat(at - 2)}${val.slice(at)}`
          : val;
      }
      return `${val.slice(0, 2)}${'*'.repeat(Math.max(0, val.length - 4))}${val.slice(-2)}`;
    };

    const displayId = (id: string) =>
      'L' + id.replace(/\D/g, '').slice(-9).padStart(9, '0');

    const rows = leads.map((l) => {
      const jsonArr = (v: unknown) =>
        Array.isArray(v) ? (v as string[]).join(', ') : '';

      const fixed = [
        displayId(l.id),
        l.name,
        mask(l.email, 'email'),
        mask(l.phone, 'phone'),
        l.city, l.state, l.course, l.college, l.kappCollegeId,
        l.campaign, l.leadType, l.leadOrigin, l.leadZone,
        l.status,
        l.uploadedBy?.name ?? '',
        l.assignedTo?.name   ?? '',
        l.assignedBy?.name   ?? '',
        l.assignedFrom?.name ?? '',
        l.prevAssignee2?.name ?? '',
        new Date(l.updatedAt).toLocaleDateString('en-GB'),
        new Date(l.createdAt).toLocaleDateString('en-GB'),
        l.uploadedAt ? new Date(l.uploadedAt).toLocaleDateString('en-GB') : '',
        l.primaryApplicationConfirm ?? '',
        l.primaryAdmissionConfirm   ?? '',
        l.leadConfirmation          ?? '',
        l.leadStage                 ?? '',
        l.leadVerification          ?? '',
        l.dataCallingType           ?? '',
        l.profile?.budget      ?? '',
        l.profile?.courseType  ?? '',
        l.profile?.collegeType ?? '',
        jsonArr(l.profile?.preferredCourseIds),
        jsonArr(l.profile?.preferredCollegeIds),
        jsonArr(l.profile?.preferredCityNames),
        jsonArr(l.profile?.preferredStateNames),
        String(l._count.feedbacks),
      ].map(esc);

      const fbCols: string[] = [];
      for (let i = 0; i < maxFeedbacks; i++) {
        const fb = l.feedbacks[i];
        if (fb) {
          fbCols.push(
            esc(fb.feedbackOption?.label ?? ''),
            esc(fb.remarks ?? ''),
            esc(new Date(fb.createdAt).toLocaleDateString('en-GB')),
          );
        } else {
          fbCols.push('""', '""', '""');
        }
      }

      return [...fixed, ...fbCols].join(',');
    });

    const csv = [allHeaders.map(esc).join(','), ...rows].join('\n');
    const filename = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type':        'text/csv;charset=utf-8;',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    console.error('[leads/export GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
