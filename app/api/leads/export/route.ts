import { NextRequest, NextResponse } from 'next/server';
import { collegeLeadFields } from '@/lib/college-lead-fields';
import { nonFeedbackQuerySchema, buildNonFeedbackFilters, buildFeedbackFilter } from '@/lib/lead-query-filters';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { IST_TIMEZONE } from '@/lib/ist-time';
import { logActivity } from '@/lib/permissions';
import { Feature, Prisma } from '@prisma/client';

// Feedback timestamps are shown in IST, like the rest of the app — the bare
// toLocaleString() used for the lead-level date columns renders in the server's
// zone (UTC in production), which we deliberately don't want for these.
// "DD/MM/YYYY, hh:mm:ss am/pm" matches the en-GB date style already used here.
function fmtIstDateTime(d: Date | string): string {
  return new Date(d).toLocaleString('en-GB', {
    timeZone: IST_TIMEZONE,
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  });
}

/**
 * The SAME schema the leads list uses, plus the feedback selection.
 *
 * This route used to keep its own copy, and it had drifted: the page sends 27
 * filter parameters and this list accepted 21. Zod strips unknown keys rather
 * than erroring, so `dataCallingType`, `dealType`, `leadStage`,
 * `leadConfirmation`, `leadVerification`, `primaryAppConfirm` and
 * `primaryAdmConfirm` were silently discarded — a filtered download quietly
 * returned far more than the screen showed. Himanshu filtered to P1, saw 8,145
 * leads, and downloaded 80,847.
 *
 * Sharing the schema and the builder is what makes "what you see is what you
 * download" true by construction rather than by two lists being kept in step.
 */
const querySchema = nonFeedbackQuerySchema.extend({
  feedbackTab:         z.enum(['all', 'fresh', 'interested', 'followup', 'not_interested']).optional(),
  feedbackOptionIds:   z.string().optional(),
  feedbackCategoryIds: z.string().optional(),
});

function esc(v: string | null | undefined): string {
  const s = (v ?? '').toString();
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
  return `"${s}"`;
}

/**
 * A sanity bound, not a working limit.
 *
 * Set to 50,000 when the export was first streamed, which turned out to be
 * wrong within a day: the floor had legitimately exported 64,517 rows on
 * 16 Sept, and by 19 Sept the table held 135,469, so an unfiltered Download
 * returned 413 and — because the client swallowed the error — simply appeared
 * to do nothing. The cap was sized for the OLD behaviour, where a big export
 * meant loading everything into memory. Streaming removed that danger: memory
 * is now flat regardless of size, so a large export is merely slow, and the
 * one-at-a-time guard stops several running together.
 *
 * What remains is a guard against an absurd request, well above any real one.
 */
const MAX_EXPORT_ROWS = 200_000;

/** Rows fetched per round trip. Small enough that memory stays flat. */
const EXPORT_BATCH = 1_000;

/**
 * One export at a time, per process.
 *
 * On a single-core box three agents clicking Download together is three full
 * scans competing for the same CPU, which is how a slow export becomes an
 * outage. The second caller is told to wait rather than joining in.
 */
let exportInProgress = false;

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const canDownload = await hasPermission(session.user.role, Feature.DOWNLOAD_DATA);
    if (!canDownload) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    if (exportInProgress) {
      return NextResponse.json(
        { error: 'Another export is already running. Please try again in a moment.' },
        { status: 429 },
      );
    }

    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
    if (!parsed.success) return NextResponse.json({ error: 'Invalid params' }, { status: 400 });

    const { feedbackTab, feedbackOptionIds, feedbackCategoryIds } = parsed.data;

    const accessClause = getLeadWhereClause({ id: session.user.id, role: session.user.role });
    const filters = await buildNonFeedbackFilters(prisma, parsed.data, session.user);

    // Identical to the leads list — same four tabs, same clauses.
    if (feedbackTab && feedbackTab !== 'all') {
      if (feedbackTab === 'fresh')          filters.push({ feedbacks: { none: {} } });
      if (feedbackTab === 'followup')       filters.push({ feedbacks: { some: {} } });
      if (feedbackTab === 'interested')     filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'interested',     mode: 'insensitive' } } } } });
      if (feedbackTab === 'not_interested') filters.push({ feedbacks: { some: { feedbackOption: { label: { contains: 'not interested', mode: 'insensitive' } } } } });
    }
    const feedbackFilter = await buildFeedbackFilter(prisma, feedbackOptionIds, feedbackCategoryIds);
    if (feedbackFilter) filters.push(feedbackFilter);

    const where = filters.length > 0 ? { AND: [accessClause, ...filters] } : accessClause;

    const LEAD_SELECT = {
        id:          true,
        name:        true,
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
        dealType:                  true,
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
    } as const;

    /**
     * Streamed in batches, never assembled in memory.
     *
     * This route used to load every matching lead — with every follow-up
     * attached — build the whole CSV as one string, and only then send it. With
     * 134,747 leads and 103,101 follow-ups on a 908 MB box that was enough to
     * put the machine into swap and starve every other request of a database
     * connection: agents saw "Application error" on All Leads, incoming leads
     * were rejected on /api/v1/leads, and follow-ups failed to save. One click
     * on Download could take the CRM out for everyone.
     *
     * Now it walks the result set with a cursor, formats each page and writes it
     * straight to the response. Memory stays flat whether the export is 500 rows
     * or 130,000, and the browser starts receiving data almost immediately
     * instead of waiting for the whole file.
     */
    const total = await prisma.lead.count({ where });
    if (total > MAX_EXPORT_ROWS) {
      return NextResponse.json({
        error: `That is ${total.toLocaleString('en-IN')} leads. Narrow the filters to `
          + `${MAX_EXPORT_ROWS.toLocaleString('en-IN')} or fewer, or ask for a database export.`,
      }, { status: 413 });
    }

    /**
     * The follow-up columns are dynamic — Follow-up 1..N, where N is the deepest
     * follow-up count in the result set. The old code knew N only after loading
     * everything, which is exactly what we are no longer doing, so it comes from
     * one aggregate instead. Get this wrong and the header stops matching the
     * rows.
     */
    const deepest = await prisma.leadFeedback.aggregate({
      where: { lead: where },
      _max: { followUpNumber: true },
    });
    const maxFeedbacks = deepest._max.followUpNumber ?? 0;

    /**
     * Email and phone are deliberately absent.
     *
     * A CSV leaves the system the moment it is written: it lands in Downloads,
     * gets forwarded, sits on a laptop, and no permission in this application
     * applies to it any more. Masking inside the CRM is undone by one export, so
     * the contact columns were the largest leak the product had.
     *
     * They are dropped for every role, including Super Admin, because the risk
     * is the file rather than the reader — an admin's download is exactly as
     * forwardable as anyone else's. The CRM itself is still the place to read a
     * lead's contact details, where access is checked per lead and masking
     * applies; to reach a lead, Call and WhatsApp work without either value ever
     * being shown.
     *
     * `Lead ID` is kept, so a row in a spreadsheet can still be traced back to
     * the lead it came from.
     */
    const fixedHeaders = [
      'Lead ID', 'Name',
      'City', 'State', 'Course', 'College', 'Client Type', 'KAPP College ID', 'Session/Year',
      'Lead Code', 'Lead Type', 'Lead Origin', 'Zone',
      'Status', 'Uploaded By',
      'Assigned To', 'Assigned By', 'Assigned From', 'Prev Assignee 2',
      'Updated At', 'Created At', 'Uploaded At',
      'Primary Application Confirm', 'Primary Admission Confirm',
      'Lead Confirmation', 'Lead Stage', 'Lead Verification', 'Data Calling Type', 'Deal Type',
      'Budget', 'Course Type', 'College Type',
      'Preferred Courses', 'Preferred Colleges', 'Preferred Cities', 'Preferred States',
      'Total Feedbacks',
      // Summary of the most recent feedback (highest follow-up number).
      'Last Feedback', 'Last Feedback Remark', 'Last Feedback Date & Time',
    ];

    // Dynamic feedback columns — sized from the aggregate above.
    const feedbackHeaders: string[] = [];
    for (let i = 1; i <= maxFeedbacks; i++) {
      feedbackHeaders.push(`Follow-up ${i} Status`, `Follow-up ${i} Remarks`, `Follow-up ${i} Date & Time`);
    }

    const allHeaders = [...fixedHeaders, ...feedbackHeaders];

    const displayId = (id: string) =>
      'L' + id.replace(/\D/g, '').slice(-9).padStart(9, '0');

    // Same live lookup the All Leads list uses, so the column downloads exactly
    // as it reads on screen.
    const { clientTypeOf, sessionYearOf } = await collegeLeadFields(prisma);

    type LeadRow = Prisma.LeadGetPayload<{ select: typeof LEAD_SELECT }>;

    const toRow = (l: LeadRow) => {
      const jsonArr = (v: unknown) =>
        Array.isArray(v) ? (v as string[]).join(', ') : '';

      // feedbacks are ordered by followUpNumber asc (and unbounded here), so the
      // last element is the most recent follow-up.
      const lastFb = l.feedbacks.length > 0 ? l.feedbacks[l.feedbacks.length - 1] : null;

      const fixed = [
        displayId(l.id),
        l.name,
        l.city, l.state, l.course, l.college, clientTypeOf(l.college),
        l.kappCollegeId, sessionYearOf(l.college),
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
        l.dealType                  ?? '',
        l.profile?.budget      ?? '',
        l.profile?.courseType  ?? '',
        l.profile?.collegeType ?? '',
        jsonArr(l.profile?.preferredCourseIds),
        jsonArr(l.profile?.preferredCollegeIds),
        jsonArr(l.profile?.preferredCityNames),
        jsonArr(l.profile?.preferredStateNames),
        String(l._count.feedbacks),
        lastFb?.feedbackOption?.label ?? '',
        lastFb?.remarks ?? '',
        lastFb ? fmtIstDateTime(lastFb.createdAt) : '',
      ].map(esc);

      const fbCols: string[] = [];
      for (let i = 0; i < maxFeedbacks; i++) {
        const fb = l.feedbacks[i];
        if (fb) {
          fbCols.push(
            esc(fb.feedbackOption?.label ?? ''),
            esc(fb.remarks ?? ''),
            esc(fmtIstDateTime(fb.createdAt)),
          );
        } else {
          fbCols.push('""', '""', '""');
        }
      }

      return [...fixed, ...fbCols].join(',');
    };

    const filename = `leads-export-${new Date().toISOString().slice(0, 10)}.csv`;
    const encoder = new TextEncoder();
    exportInProgress = true;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let written = 0;
        try {
          controller.enqueue(encoder.encode(allHeaders.map(esc).join(',') + '\n'));

          // Cursor rather than skip/take: OFFSET makes the database re-walk
          // every row it has already returned, so page 100 costs a hundred
          // times page 1. `id` is the tiebreaker because createdAt is not
          // unique and a tie would drop or repeat rows between pages.
          let cursor: string | null = null;
          for (;;) {
            const batch: LeadRow[] = await prisma.lead.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
              take: EXPORT_BATCH,
              ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
              select: LEAD_SELECT,
            });
            if (batch.length === 0) break;

            controller.enqueue(encoder.encode(batch.map(toRow).join('\n') + '\n'));
            written += batch.length;
            cursor = batch[batch.length - 1].id;
            if (batch.length < EXPORT_BATCH) break;
          }

          // Exporting is the one action that can move a whole book of leads out
          // of the CRM in a single click, so it is the highest-value thing to
          // have an audit trail for — who exported, how many rows, and with
          // which filters — for reviewing unusual activity (e.g. around a
          // resignation). Logged with the rows actually written, not the
          // estimate, so an interrupted download is recorded as what it was.
          await logActivity({
            userId: session.user.id,
            action: 'LEADS_EXPORTED',
            targetType: 'Lead',
            description: `Exported ${written} lead(s) to CSV`,
            metadata: { rowCount: written, filters: parsed.data },
          });
          controller.close();
        } catch (err) {
          console.error('[leads/export stream]', err);
          controller.error(err);
        } finally {
          exportInProgress = false;
        }
      },
      cancel() {
        // The browser gave up mid-download; stop holding the slot.
        exportInProgress = false;
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type':        'text/csv;charset=utf-8;',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // nginx already has proxy_buffering off; this tells any other proxy.
        'X-Accel-Buffering':   'no',
        'Cache-Control':       'no-store',
      },
    });
  } catch (error) {
    console.error('[leads/export GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
