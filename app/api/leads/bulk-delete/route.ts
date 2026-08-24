import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { nonFeedbackQuerySchema, buildNonFeedbackFilters, hasAnyFilter } from '@/lib/lead-query-filters';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

// Hard cap per request — a safety net against an unexpectedly broad filter
// wiping the entire table in one shot. Narrow the filters (e.g. by upload
// batch/date range) and run again if a real cleanup needs more than this.
const MAX_DELETE = 5000;

const bodySchema = nonFeedbackQuerySchema.extend({
  // The total the admin saw (and confirmed) in the preview step — re-checked
  // against a fresh live count right before deleting, so a filter that
  // quietly matched MORE leads than what was reviewed (e.g. a new upload
  // landing in between) can never slip through unnoticed.
  //
  // Optional because there are two ways to delete: by filter (every match) or
  // by explicit selection (only the rows ticked). The count guard belongs to
  // the first — a hand-picked list is already exact.
  expectedCount: z.number().int().min(0).optional(),
  /** Explicitly chosen lead ids. When present, filters are ignored entirely. */
  ids: z.array(z.string().min(1)).min(1).max(MAX_DELETE).optional(),
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
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.BULK_DELETE_LEADS))) {
      return NextResponse.json({ success: false, error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const body = await req.json().catch(() => null);
    if (body === null) return NextResponse.json({ success: false, error: 'Request body must be valid JSON', code: 'VALIDATION_ERROR' }, { status: 400 });

    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const { expectedCount, ids: chosenIds, ...query } = parsed.data;
    const bySelection = Array.isArray(chosenIds) && chosenIds.length > 0;

    // A filter-wide delete must be scoped by something; a hand-picked list is
    // its own scope, so the "at least one filter" rule does not apply to it.
    if (!bySelection && !hasAnyFilter(query)) {
      return NextResponse.json(
        { success: false, error: 'Apply at least one filter — this tool will not delete every lead unscoped', code: 'NO_FILTERS' },
        { status: 400 },
      );
    }
    if (!bySelection && expectedCount === undefined) {
      return NextResponse.json(
        { success: false, error: 'A filter delete must confirm the count it previewed', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Chosen ids are still passed through the caller's own access clause rather
    // than trusted: an id arriving in a request body is user input, and this
    // endpoint must never delete a lead the requester could not otherwise see.
    const filters = bySelection ? [] : buildNonFeedbackFilters(query, session.user);
    const where: Prisma.LeadWhereInput = {
      AND: [
        getLeadWhereClause(session.user),
        ...(bySelection ? [{ id: { in: chosenIds! } } as Prisma.LeadWhereInput] : filters),
      ],
    };

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
    // Only the filter path is guarded by the previewed count. A selection is
    // exact by construction — and if one of the chosen rows was deleted by
    // someone else in the meantime, removing the rest is still correct.
    if (!bySelection && ids.length !== expectedCount) {
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
        description: bySelection
          ? `Deleted ${result.count} hand-picked lead${result.count === 1 ? '' : 's'}`
          : `Bulk-deleted ${result.count} leads by filter`,
        // The ids are recorded on a selection delete: with no trash to restore
        // from, knowing exactly which rows went is the only trace left.
        metadata: bySelection
          ? { deletedCount: result.count, mode: 'selection', ids }
          : { deletedCount: result.count, mode: 'filter', filters: query },
      });

      return result.count;
    });

    return NextResponse.json({ success: true, deleted: deletedCount });
  } catch (error) {
    console.error('[leads/bulk-delete POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
