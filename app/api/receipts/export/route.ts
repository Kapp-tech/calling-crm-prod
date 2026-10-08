import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature } from '@prisma/client';
import { parseReceiptFilters, buildReceiptWhere } from '@/lib/receipt-filters';
import { formatIstDateTime, istDayKey } from '@/lib/ist-time';

/**
 * CSV of the Receipt Approvals queue, honouring every filter on the screen.
 *
 * Deliberately uses the SAME parse + where builder as the list route. An export
 * that re-derives its own filters is how All Leads ended up showing 8,145 rows
 * and downloading 80,847 — the two drifted and nobody noticed for weeks.
 *
 * Same permission as the list (APPROVE_RECEIPTS): anyone who can read this
 * queue can download what they are already looking at, and nobody else can.
 */

/** Always quoted — a bare campus name with a comma would otherwise split a row. */
function esc(v: string | number | null | undefined): string {
  const s = (v ?? '').toString();
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Receipts are reviewed one queue at a time, so this is thousands of rows at
 * the very most — small enough to build in memory. The cap is a guard against
 * a future where that stops being true, not a working limit.
 */
const MAX_ROWS = 50_000;

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(await hasPermission(session.user.role, Feature.APPROVE_RECEIPTS))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const filters = parseReceiptFilters(searchParams);
    const where = buildReceiptWhere(filters);

    const rows = await prisma.leadReceipt.findMany({
      where,
      orderBy: { paidDate: 'desc' },
      take: MAX_ROWS,
      select: {
        type: true, studentName: true, campusName: true, courseName: true,
        actualAmount: true, amountPaid: true, couponCodeApplied: true, referralCode: true,
        receiptNumber: true, paidDate: true, status: true, disapprovalReason: true,
        city: true, state: true, createdAt: true, reviewedAt: true,
        lead: { select: { id: true, name: true, college: true, assignedTo: { select: { name: true } } } },
        uploadedBy: { select: { name: true } },
        reviewedBy: { select: { name: true } },
      },
    });

    /**
     * Columns mirror what the page shows, plus the fields a finance check needs
     * (amounts, coupon, referral, the disapproval reason).
     *
     * No email or mobile, matching the All Leads export and the screen itself —
     * neither shows them, and a CSV leaves the system the moment it is written.
     * The receipt number and Lead ID are the keys for tracing a row back.
     */
    const headers = [
      'Type', 'Lead ID', 'Student Name', 'Lead Name', 'College', 'Campus', 'Course',
      'Actual Amount', 'Amount Paid', 'Coupon Applied', 'Referral Code',
      'Receipt No', 'Paid Date', 'City', 'State',
      'Status', 'Disapproval Reason',
      'Uploaded By', 'Uploaded At', 'Reviewed By', 'Reviewed At', 'Assigned To',
    ];

    const body = rows.map((r) => [
      r.type,
      r.lead?.id, r.studentName, r.lead?.name, r.lead?.college, r.campusName, r.courseName,
      r.actualAmount, r.amountPaid, r.couponCodeApplied ? 'Yes' : 'No', r.referralCode,
      // Date only — paidDate is a calendar date, and a time on it invites a
      // timezone question the value cannot answer.
      r.receiptNumber, istDayKey(r.paidDate), r.city, r.state,
      r.status, r.disapprovalReason,
      r.uploadedBy?.name, formatIstDateTime(r.createdAt),
      r.reviewedBy?.name, r.reviewedAt ? formatIstDateTime(r.reviewedAt) : '',
      r.lead?.assignedTo?.name,
    ].map(esc).join(','));

    // BOM so Excel opens UTF-8 names correctly instead of mangling them.
    const csv = '﻿' + [headers.map(esc).join(','), ...body].join('\n');

    const stamp = istDayKey(new Date());
    const scope = filters.status === 'ALL' ? 'all' : filters.status.toLowerCase();
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="receipts-${scope}-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[receipts/export GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
