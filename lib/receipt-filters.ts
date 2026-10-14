import { Prisma, ReceiptStatus, ReceiptType } from '@prisma/client';
import { istStartOfDay, istEndOfDay } from '@/lib/ist-time';

/**
 * The Receipt Approvals filter set, in ONE place.
 *
 * Shared by the list (`/api/receipts`) and the CSV export
 * (`/api/receipts/export`) because the last time an export built its own
 * filters they silently drifted: All Leads showed 8,145 rows and downloaded
 * 80,847, since the export's schema quietly dropped the parameters it did not
 * declare. One builder means the download cannot disagree with the screen.
 *
 * Add a filter here and both paths get it; there is nowhere else to forget.
 */

/** Read the filters off a querystring. Unknown/blank values are ignored, never guessed. */
export function parseReceiptFilters(searchParams: URLSearchParams) {
  const status = (searchParams.get('status') ?? 'PENDING').toUpperCase();
  const type = searchParams.get('type')?.toUpperCase();
  return {
    status,
    type,
    search: searchParams.get('search')?.trim() || undefined,
    // Paid date, not createdAt: the money is what this screen is about, and it
    // is the same field the KPI and Caller-wise report count receipts by. A
    // receipt approved in October for a September payment belongs to September.
    from: searchParams.get('from')?.trim() || undefined,
    to: searchParams.get('to')?.trim() || undefined,
  };
}

export type ReceiptFilters = ReturnType<typeof parseReceiptFilters>;

export function buildReceiptWhere(f: ReceiptFilters): Prisma.LeadReceiptWhereInput {
  // IST day boundaries, so "1 Oct to 1 Oct" means that whole day as the office
  // experienced it. A bare `new Date('2026-10-01')` is midnight UTC — 05:30 IST
  // — which would drop the first five and a half hours of the day.
  const paidDate =
    f.from || f.to
      ? {
          ...(f.from ? { gte: istStartOfDay(f.from) } : {}),
          ...(f.to ? { lte: istEndOfDay(f.to) } : {}),
        }
      : undefined;

  return {
    ...(f.status !== 'ALL' && f.status in ReceiptStatus
      ? { status: f.status as ReceiptStatus }
      : {}),
    ...(f.type && f.type in ReceiptType ? { type: f.type as ReceiptType } : {}),
    ...(paidDate ? { paidDate } : {}),
    ...(f.search
      ? {
          OR: [
            { studentName: { contains: f.search, mode: 'insensitive' as const } },
            { email: { contains: f.search, mode: 'insensitive' as const } },
            { mobile: { contains: f.search } },
            { receiptNumber: { contains: f.search, mode: 'insensitive' as const } },
            { lead: { id: { contains: f.search, mode: 'insensitive' as const } } },
            // The lead's own code — searchable now that the table shows it.
            // Shared builder, so the CSV narrows identically.
            { lead: { campaign: { contains: f.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };
}
