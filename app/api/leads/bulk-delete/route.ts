import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { nonFeedbackQuerySchema, buildNonFeedbackFilters, hasAnyFilter } from '@/lib/lead-query-filters';

// Hard cap per request — a safety net against an unexpectedly broad filter
// wiping the entire table in one shot. Narrow the filters (e.g. by upload
// batch/date range) and run again if a real cleanup needs more than this.
const MAX_DELETE = 5000;

const bodySchema = nonFeedbackQuerySchema.extend({
  // The total the admin saw (and confirmed) in the preview step — re-checked
  // against a fresh live count right before deleting, so a filter that
  // quietly matched MORE leads than what was reviewed (e.g. a new upload
  // landing in between) can never slip through unnoticed.
  expectedCount: z.number().int().min(0),
});

// Permanently deletes every lead matching the given filters — the execute
// side of the Bulk Delete Leads tool, for cleaning up mistaken CSV uploads.
// Hard-restricted to SUPER_ADMIN (not permission-matrix configurable): this
// is irreversible (no soft-delete/trash in this schema) and cascades to the
// lead's feedback, receipts, scheduled calls, and profile.
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Only Super Admin can use this tool', code: 'FORBIDDEN' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (body === null) return NextResponse.json({ success: false, error: 'Request body must be valid JSON', code: 'VALIDATION_ERROR' }, { status: 400 });

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const { expectedCount, ...query } = parsed.data;

    if (!hasAnyFilter(query)) {
      return NextResponse.json(
        { success: false, error: 'Apply at least one filter — this tool will not delete every lead unscoped', code: 'NO_FILTERS' },
        { status: 400 },
      );
    }

    const filters = buildNonFeedbackFilters(query, session.user);
    const where: Prisma.LeadWhereInput = { AND: [getLeadWhereClause(session.user), ...filters] };

    const ids = (await prisma.lead.findMany({ where, select: { id: true }, take: MAX_DELETE + 1 })).map((l) => l.id);

    if (ids.length === 0) {
      return NextResponse.json({ success: false, error: 'No leads match these filters anymore — refresh the preview', code: 'NOT_FOUND' }, { status: 404 });
    }
    if (ids.length > MAX_DELETE) {
      return NextResponse.json(
        { success: false, error: `${ids.length}+ leads match — this tool caps a single delete at ${MAX_DELETE}. Narrow your filters (e.g. by upload batch or a shorter date range) and try again.`, code: 'TOO_MANY' },
        { status: 400 },
      );
    }
    if (ids.length !== expectedCount) {
      return NextResponse.json(
        {
          success: false,
          error: `The matching count changed since you last previewed (was ${expectedCount}, now ${ids.length}) — please re-check the preview before deleting.`,
          code: 'COUNT_MISMATCH',
          total: ids.length,
        },
        { status: 409 },
      );
    }

    const deletedCount = await prisma.$transaction(async (tx) => {
      // Lead.referredById is a self-relation with no cascade — clear any
      // referrals pointing at a lead we're about to delete first, or the
      // deleteMany below would fail on the FK constraint.
      await tx.lead.updateMany({ where: { referredById: { in: ids } }, data: { referredById: null } });

      const result = await tx.lead.deleteMany({ where: { id: { in: ids } } });

      await logActivity({
        userId: session.user.id,
        action: 'LEAD_DELETED',
        targetId: 'bulk',
        targetType: 'Lead',
        description: `Bulk-deleted ${result.count} leads by filter`,
        metadata: { deletedCount: result.count, filters: query },
      });

      return result.count;
    });

    return NextResponse.json({ success: true, deleted: deletedCount });
  } catch (error) {
    console.error('[leads/bulk-delete POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
