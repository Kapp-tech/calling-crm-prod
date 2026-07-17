import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { Feature } from '@prisma/client';

// True, role-scoped per-batch counts — independent of whatever slice of
// leads happens to be loaded on the current page. Lets the Lead Approvals
// page show an accurate "Approve All (N)" per request/batch regardless of
// how many thousands of leads it contains or which page it appears on.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const [canView, canReport] = await Promise.all([
      hasPermission(session.user.role, Feature.VIEW_LEADS),
      hasPermission(session.user.role, Feature.VIEW_REPORTS),
    ]);
    if (!canView && !canReport) {
      return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    const batchIds = (new URL(req.url).searchParams.get('batchIds') ?? '')
      .split(',').map((s) => s.trim()).filter(Boolean);
    if (batchIds.length === 0) return NextResponse.json({});

    const accessClause = getLeadWhereClause(session.user);

    const grouped = await prisma.lead.groupBy({
      by: ['batchId', 'status'],
      where: { AND: [accessClause, { batchId: { in: batchIds } }] },
      _count: true,
    });

    const summary: Record<string, { pending: number; approved: number; disapproved: number; total: number }> = {};
    for (const id of batchIds) summary[id] = { pending: 0, approved: 0, disapproved: 0, total: 0 };
    for (const row of grouped) {
      if (!row.batchId) continue;
      const s = summary[row.batchId];
      if (!s) continue;
      if (row.status === 'PENDING')     s.pending = row._count;
      if (row.status === 'APPROVED')    s.approved = row._count;
      if (row.status === 'DISAPPROVED') s.disapproved = row._count;
      s.total += row._count;
    }

    return NextResponse.json(summary);
  } catch (error) {
    console.error('[leads/batch-summary GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
