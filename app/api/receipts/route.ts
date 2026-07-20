import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature, Prisma, ReceiptStatus, ReceiptType } from '@prisma/client';

// Cross-lead receipt approval queue for Super Admin (and anyone else granted
// APPROVE_RECEIPTS via the permission matrix). Defaults to PENDING so the
// page opens straight on the actionable work; status=ALL / APPROVED /
// DISAPPROVED lets the same page double as a review history.
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(await hasPermission(session.user.role, Feature.APPROVE_RECEIPTS))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const statusParam = (searchParams.get('status') ?? 'PENDING').toUpperCase();
    const typeParam    = searchParams.get('type')?.toUpperCase();
    const search       = searchParams.get('search')?.trim();
    const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '25', 10) || 25));

    const where: Prisma.LeadReceiptWhereInput = {
      ...(statusParam !== 'ALL' && statusParam in ReceiptStatus
        ? { status: statusParam as ReceiptStatus }
        : {}),
      ...(typeParam && typeParam in ReceiptType ? { type: typeParam as ReceiptType } : {}),
      ...(search
        ? {
            OR: [
              { studentName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { mobile: { contains: search } },
              { receiptNumber: { contains: search, mode: 'insensitive' } },
              { lead: { id: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [receipts, total, statusCounts] = await Promise.all([
      prisma.leadReceipt.findMany({
        where,
        // Oldest pending request first — first come, first reviewed.
        orderBy: { createdAt: statusParam === 'PENDING' ? 'asc' : 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          lead: { select: { id: true, name: true, phone: true, assignedTo: { select: { id: true, name: true } } } },
          uploadedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
      }),
      prisma.leadReceipt.count({ where }),
      prisma.leadReceipt.groupBy({ by: ['status'], _count: { id: true } }),
    ]);

    // Never expose the on-disk file path — files are served only via the
    // authenticated /file route, keyed by receipt id.
    const sanitized = receipts.map(({ filePath: _filePath, ...rest }) => rest);

    const counts = { PENDING: 0, APPROVED: 0, DISAPPROVED: 0 } as Record<ReceiptStatus, number>;
    for (const c of statusCounts) counts[c.status] = c._count.id;

    return NextResponse.json({
      receipts: sanitized,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      counts,
    });
  } catch (error) {
    console.error('[receipts GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
