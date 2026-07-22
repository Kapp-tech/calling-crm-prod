import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';

export type TimelineEventType =
  | 'CREATED'
  | 'APPROVED'
  | 'ASSIGNED'
  | 'FEEDBACK'
  | 'ARCHIVED_FEEDBACK'
  | 'SCHEDULED_CALL'
  | 'RECEIPT';

export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  title: string;
  subtitle?: string;
  badge?: string;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const isAgent = session.user.role === 'COUNSELLING_AGENT';

    const [lead, feedbacks, archivedFeedbacks, scheduledCalls, receipts] = await Promise.all([
      prisma.lead.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          createdAt: true,
          assignedAt: true,
          approvedAt: true,
          lastAssignmentWasFresh: true,
          assignedTo: { select: { name: true } },
          assignedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
          uploadedBy: { select: { name: true } },
        },
      }),
      prisma.leadFeedback.findMany({
        where: { leadId: params.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          followUpNumber: true,
          remarks: true,
          createdAt: true,
          agent: { select: { name: true } },
          feedbackOption: { select: { label: true } },
        },
      }),
      // Feedback from before a "reassign as fresh" reset — preserved for
      // every role except the assigned agent, who should see this lead as
      // clean. Not fetched at all for the agent (no point querying it).
      isAgent
        ? Promise.resolve([])
        : prisma.leadFeedbackArchive.findMany({
            where: { leadId: params.id },
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              followUpNumber: true,
              remarks: true,
              createdAt: true,
              cycle: true,
              agent: { select: { name: true } },
              feedbackOption: { select: { label: true } },
            },
          }),
      prisma.scheduledCall.findMany({
        where: { leadId: params.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          scheduledAt: true,
          status: true,
          note: true,
          createdAt: true,
          agent: { select: { name: true } },
        },
      }),
      prisma.leadReceipt.findMany({
        where: { leadId: params.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          type: true,
          campusName: true,
          amountPaid: true,
          createdAt: true,
          uploadedBy: { select: { name: true } },
        },
      }),
    ]);

    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const events: TimelineEvent[] = [];

    // Lead created
    events.push({
      id: `created-${lead.id}`,
      type: 'CREATED',
      timestamp: lead.createdAt.toISOString(),
      title: 'Lead added to CRM',
      subtitle: lead.uploadedBy ? `Uploaded by ${lead.uploadedBy.name}` : undefined,
    });

    // Lead approved
    if (lead.approvedAt) {
      events.push({
        id: `approved-${lead.id}`,
        type: 'APPROVED',
        timestamp: lead.approvedAt.toISOString(),
        title: 'Lead approved',
        subtitle: lead.approvedBy ? `By ${lead.approvedBy.name}` : undefined,
      });
    }

    // Lead assigned
    if (lead.assignedAt && lead.assignedTo) {
      events.push({
        id: `assigned-${lead.id}`,
        type: 'ASSIGNED',
        timestamp: lead.assignedAt.toISOString(),
        title: lead.lastAssignmentWasFresh
          ? `Reassigned to ${lead.assignedTo.name} as a Fresh Lead`
          : `Assigned to ${lead.assignedTo.name}`,
        subtitle: lead.assignedBy ? `By ${lead.assignedBy.name}` : undefined,
        badge: lead.lastAssignmentWasFresh ? 'FRESH' : undefined,
      });
    }

    // Feedback submissions (current assignment cycle)
    for (const fb of feedbacks) {
      events.push({
        id: `feedback-${fb.id}`,
        type: 'FEEDBACK',
        timestamp: fb.createdAt.toISOString(),
        title: `Follow-up #${fb.followUpNumber} — ${fb.feedbackOption.label}`,
        subtitle: [fb.agent.name, fb.remarks].filter(Boolean).join(' · '),
        badge: fb.feedbackOption.label,
      });
    }

    // Feedback from before a fresh reassignment — visible to every role
    // except the currently-assigned agent (see query above).
    for (const fb of archivedFeedbacks) {
      events.push({
        id: `archived-feedback-${fb.id}`,
        type: 'ARCHIVED_FEEDBACK',
        timestamp: fb.createdAt.toISOString(),
        title: `Follow-up #${fb.followUpNumber} — ${fb.feedbackOption.label}`,
        subtitle: [fb.agent.name, fb.remarks].filter(Boolean).join(' · '),
        badge: `Previous Assignment · Cycle ${fb.cycle}`,
      });
    }

    // Scheduled calls
    for (const sc of scheduledCalls) {
      const scheduledLabel = new Date(sc.scheduledAt).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      });
      events.push({
        id: `schedule-${sc.id}`,
        type: 'SCHEDULED_CALL',
        timestamp: sc.createdAt.toISOString(),
        title: `Call scheduled for ${scheduledLabel}`,
        subtitle: [sc.agent.name, sc.note].filter(Boolean).join(' · '),
        badge: sc.status,
      });
    }

    // Receipt uploads
    for (const r of receipts) {
      events.push({
        id: `receipt-${r.id}`,
        type: 'RECEIPT',
        timestamp: r.createdAt.toISOString(),
        title: `${r.type === 'APPLICATION' ? 'Application' : 'Admission'} receipt uploaded`,
        subtitle: [r.campusName, `₹${r.amountPaid}`, `by ${r.uploadedBy.name}`].filter(Boolean).join(' · '),
        badge: r.type,
      });
    }

    // Sort chronologically descending (most recent first)
    events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return NextResponse.json(events);
  } catch (err) {
    console.error('[lead-timeline GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
