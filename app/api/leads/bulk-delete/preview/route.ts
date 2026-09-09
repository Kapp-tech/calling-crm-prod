import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getLeadWhereClause } from '@/lib/lead-access';
import { nonFeedbackQuerySchema, buildNonFeedbackFilters, hasAnyFilter } from '@/lib/lead-query-filters';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

const SAMPLE_SIZE = 50;

// Dry-run for the Bulk Delete Leads tool — same filter engine as /api/leads,
// so what the admin previews here is exactly what /api/leads/bulk-delete
// would remove. Hard-restricted to SUPER_ADMIN (not permission-matrix
// configurable), since this is the read side of an irreversible delete.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Only Super Admin can use this tool', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.BULK_DELETE_LEADS))) {
      return NextResponse.json({ success: false, error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const { searchParams } = new URL(req.url);
    const parsed = nonFeedbackQuerySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (!hasAnyFilter(parsed.data)) {
      return NextResponse.json(
        { success: false, error: 'Apply at least one filter before previewing — this tool will not target every lead unscoped', code: 'NO_FILTERS' },
        { status: 400 },
      );
    }

    const filters = await buildNonFeedbackFilters(prisma, parsed.data, session.user);
    const where: Prisma.LeadWhereInput = { AND: [getLeadWhereClause(session.user), ...filters] };

    const [total, sample] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        take: SAMPLE_SIZE,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          city: true,
          state: true,
          college: true,
          status: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
          assignedTo: { select: { name: true } },
          batch: { select: { fileName: true } },
        },
      }),
    ]);

    return NextResponse.json({ success: true, total, sample });
  } catch (error) {
    console.error('[leads/bulk-delete/preview GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
