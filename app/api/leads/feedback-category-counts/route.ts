import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { nonFeedbackQuerySchema, buildNonFeedbackFilters } from '@/lib/lead-query-filters';
import { Feature } from '@prisma/client';

/**
 * Lead counts per feedback category, for the colored count badges on the
 * All Leads category pills. Accepts the same filter query params as
 * /api/leads (search, city, course, date range, etc. — everything except
 * the feedback selection itself) so the badges always agree with however
 * many leads actually show up when a category pill is clicked — they share
 * the exact same filter-building logic via lib/lead-query-filters.ts.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const [canView, canReport] = await Promise.all([
    hasPermission(session.user.role, Feature.VIEW_LEADS),
    hasPermission(session.user.role, Feature.VIEW_REPORTS),
  ]);
  if (!canView && !canReport) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const parsed = nonFeedbackQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const accessClause = getLeadWhereClause({ id: session.user.id, role: session.user.role });
    const filters = await buildNonFeedbackFilters(prisma, parsed.data, session.user);
    const where = { AND: [accessClause, ...filters, { currentFeedbackOptionId: { not: null } }] };

    const [options, grouped] = await Promise.all([
      prisma.feedbackOption.findMany({ select: { id: true, categoryId: true } }),
      prisma.lead.groupBy({
        by: ['currentFeedbackOptionId'],
        where,
        _count: true,
      }),
    ]);

    const categoryByOption = new Map(options.map((o) => [o.id, o.categoryId]));
    const counts: Record<string, number> = {};

    for (const row of grouped) {
      const optionId = row.currentFeedbackOptionId;
      if (!optionId) continue;
      const categoryId = categoryByOption.get(optionId);
      if (!categoryId) continue;
      counts[categoryId] = (counts[categoryId] ?? 0) + row._count;
    }

    return NextResponse.json(counts);
  } catch (err) {
    console.error('[leads/feedback-category-counts GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
