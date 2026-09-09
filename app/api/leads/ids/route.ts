import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { nonFeedbackQuerySchema, buildNonFeedbackFilters, buildFeedbackFilter } from '@/lib/lead-query-filters';
import { Feature } from '@prisma/client';

/**
 * Resolves a filtered page of lead IDs, for "Select rows 1–N" and "Select all
 * filtered" on Assign Leads.
 *
 * This MUST return exactly the leads /api/leads shows, in the same order — the
 * page maps positions in this list onto the rows it is displaying, and then
 * assigns whatever comes back. It therefore shares the query schema, the filter
 * builders and the ordering with that route rather than restating them.
 *
 * It previously kept its own hand-written copy of the filter logic, which had
 * drifted: updatedFrom/updatedTo, feedbackCategoryIds, batchId, uploadedById,
 * leadStage, leadConfirmation, leadVerification, dataCallingType, dealType and
 * the two primary-confirm flags were all absent. Zod strips unknown keys, so
 * those filters arrived and were discarded silently — the endpoint answered a
 * *broader* question than the table was asking. Selecting "rows 1–10" returned
 * ten ids from that wider set, which is why the highlighted rows did not match
 * the ticked count, and why assigning could touch leads outside the filter.
 */
const querySchema = nonFeedbackQuerySchema.extend({
  feedbackTab:         z.enum(['all', 'fresh', 'interested', 'followup', 'not_interested']).optional(),
  feedbackOptionIds:   z.string().optional(),
  feedbackCategoryIds: z.string().optional(),
  skip:  z.coerce.number().min(0).optional(),
  limit: z.coerce.number().min(1).max(10000).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const canAssign = await hasPermission(session.user.role, Feature.ASSIGN_LEADS);
  if (!canAssign) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  // strict(): an unrecognised filter is now an error rather than something
  // quietly dropped. A future filter added to the table but not wired through
  // here fails loudly instead of silently widening the selection.
  const parsed = querySchema.strict().safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { feedbackTab, feedbackOptionIds, feedbackCategoryIds, skip, limit } = parsed.data;

  const accessClause = getLeadWhereClause({ id: session.user.id, role: session.user.role });
  const filters = await buildNonFeedbackFilters(prisma, parsed.data, session.user);

  // Kept identical to /api/leads — see the note above.
  if (feedbackTab && feedbackTab !== 'all') {
    if (feedbackTab === 'fresh')          filters.push({ feedbacks: { none: {} } });
    if (feedbackTab === 'followup')       filters.push({ feedbacks: { some: {} } });
    if (feedbackTab === 'interested')     filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'interested',     mode: 'insensitive' } } } } });
    if (feedbackTab === 'not_interested') filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'not interested', mode: 'insensitive' } } } } });
  }
  const feedbackFilter = await buildFeedbackFilter(prisma, feedbackOptionIds, feedbackCategoryIds);
  if (feedbackFilter) filters.push(feedbackFilter);

  const where = filters.length > 0 ? { AND: [accessClause, ...filters] } : accessClause;

  try {
    const orderBy = ['COUNSELLING_AGENT', 'COUNSELLING_TL'].includes(session.user.role)
      ? [{ assignedAt: 'desc' as const }, { createdAt: 'desc' as const }, { id: 'asc' as const }]
      : [{ createdAt: 'desc' as const }, { id: 'asc' as const }];

    const [leads, matching] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: { id: true },
        skip: skip ?? 0,
        take: limit ?? 10000,
        orderBy,
      }),
      prisma.lead.count({ where }),
    ]);

    // `total` is how many leads match the filter overall, not how many ids this
    // page returned — the caller needs the former to know a range overshot the
    // result set. `count` is the size of this response.
    return NextResponse.json({ ids: leads.map((l) => l.id), count: leads.length, total: matching });
  } catch (err) {
    console.error('[leads/ids GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
