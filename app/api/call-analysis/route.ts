import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isMaskedRole } from '@/lib/permissions';
import { Prisma } from '@prisma/client';
import { resolveCallAnalysisScope } from '@/lib/call-analysis-scope';
import { istStartOfDay, istEndOfDay } from '@/lib/ist-time';
import { maskPhone } from '@/lib/data-masking';
import { gradeBand, BAND_RANK } from '@/lib/call-analysis-criteria';
import { callsForLead } from '@/lib/call-log-matching';

/**
 * Scored calls, newest verdict first.
 *
 * Gated on VIEW_REPORTS rather than a new permission: this is agent
 * performance data in the same sense the calling reports are, and a role that
 * can already read those should not need a second grant to read this.
 *
 * Ordered by scoredAt — when the analyser judged the call — not receivedAt. A
 * backfill delivers last week's verdicts today, and sorting by arrival would
 * shuffle an old call to the top of the list.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Whose calls this session may see. Everything below only narrows it.
    const scope = await resolveCallAnalysisScope(session.user);
    if (!scope) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const sp = new URL(req.url).searchParams;
    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit') ?? '25', 10) || 25));
    const grade = sp.get('grade')?.trim() || undefined;
    const intent = sp.get('intent')?.trim() || undefined;
    // An agent has no agent filter — they are already pinned to themselves,
    // and honouring the parameter would be the one way to read someone else's
    // calls. Ignored rather than rejected: a stale bookmark should still load.
    const agentId = scope.view === 'agent' ? undefined : sp.get('agentId')?.trim() || undefined;
    const leadId = sp.get('leadId')?.trim() || undefined;
    const search = sp.get('search')?.trim() || undefined;
    const from = sp.get('from')?.trim() || undefined;
    const to = sp.get('to')?.trim() || undefined;
    // A view, not a status: "flagged" is fatal OR needs review, because both
    // mean a human should look, and splitting them into two filters makes the
    // reader run the list twice to find everything that wants attention.
    const view = sp.get('view')?.trim();

    const scoredAt =
      from || to
        ? {
            ...(from ? { gte: istStartOfDay(from) } : {}),
            ...(to ? { lte: istEndOfDay(to) } : {}),
          }
        : undefined;

    const where: Prisma.CallAnalysisWhereInput = {
      ...(grade ? { qaGrade: { equals: grade, mode: 'insensitive' } } : {}),
      ...(intent ? { intent: { equals: intent, mode: 'insensitive' } } : {}),
      ...(scoredAt ? { scoredAt } : {}),
      ...(view === 'flagged' ? { OR: [{ fatalError: true }, { needsReview: true }] } : {}),
      ...(agentId ? { callLog: { agentId } } : {}),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { summary: { contains: search, mode: 'insensitive' } },
                  { callLog: { uniqueId: { contains: search, mode: 'insensitive' } } },
                  { callLog: { phoneNumber: { contains: search } } },
                  { callLog: { lead: { id: { contains: search, mode: 'insensitive' } } } },
                  { callLog: { lead: { name: { contains: search, mode: 'insensitive' } } } },
                ],
              },
            ],
          }
        : {}),
    };

    // A lead's calls are not simply those carrying its id — see
    // lib/call-log-matching.ts. Resolving it the same way means the list this
    // links to always contains the call whose score was clicked.
    let leadFilter: Prisma.CallAnalysisWhereInput | null = null;
    let leadHeader: { id: string; name: string } | null = null;
    if (leadId) {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, name: true, phone: true },
      });
      if (!lead) {
        return NextResponse.json({ error: `No lead ${leadId}` }, { status: 404 });
      }
      leadHeader = { id: lead.id, name: lead.name };
      leadFilter = { callLog: callsForLead(lead.id, lead.phone) };
    }
    // Summary cards: the session's own scope, narrowed to one lead when the
    // page is scoped to a lead. An agent's cards therefore count their calls,
    // not the whole org's.
    const statsWhere: Prisma.CallAnalysisWhereInput =
      leadFilter ? { AND: [scope.where, leadFilter] } : scope.where;

    // The session scope is not optional, so it is ANDed on last and cannot be
    // displaced by anything a caller sent.
    const mandatory = [scope.where, ...(leadFilter ? [leadFilter] : [])];
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      ...mandatory,
    ];

    const [rows, total, graded, flagged, fatal, avg, byGrade, intents] = await Promise.all([
      prisma.callAnalysis.findMany({
        where,
        orderBy: [{ scoredAt: 'desc' }, { receivedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, score: true, maxScore: true, qaGrade: true, qaStatus: true,
          intent: true, fatalError: true, needsReview: true, redFlags: true,
          summary: true, metrics: true, scoredAt: true, receivedAt: true,
          callLog: {
            select: {
              id: true, uniqueId: true, phoneNumber: true, startedAt: true,
              talkTimeSeconds: true, ringTimeSeconds: true, recordingUrl: true,
              agent: { select: { id: true, name: true } },
              lead: { select: { id: true, name: true, college: true } },
            },
          },
        },
      }),
      prisma.callAnalysis.count({ where }),
      /**
       * Headline figures ignore the filters, like the receipt cards: a summary
       * tile says how many exist, not how many survive the current search.
       *
       * The one exception is `leadId`. That is not a filter in the same
       * sense — it changes what the page is about — so leaving the cards
       * global would put the whole org's average above one lead's calls.
       */
      prisma.callAnalysis.count({ where: statsWhere }),
      prisma.callAnalysis.count({
        where: { AND: [statsWhere, { OR: [{ fatalError: true }, { needsReview: true }] }] },
      }),
      prisma.callAnalysis.count({ where: { AND: [statsWhere, { fatalError: true }] } }),
      prisma.callAnalysis.aggregate({ _avg: { score: true }, where: statsWhere }),
      prisma.callAnalysis.groupBy({ by: ['qaGrade'], _count: { _all: true }, where: statsWhere }),
      // Grade and intent vocabularies belong to the analyser, not to us. Asking
      // the data what values exist means a new grade or intent appears in the
      // filters by itself instead of being invisible until someone edits a
      // hard-coded list here.
      prisma.callAnalysis.findMany({
        where: { intent: { not: null } },
        distinct: ['intent'],
        select: { intent: true },
        orderBy: { intent: 'asc' },
      }),
    ]);

    const masked = await isMaskedRole(session.user.role);

    const payload = rows.map(({ callLog, ...r }) => ({
      ...r,
      callLog: {
        id: callLog.id,
        uniqueId: callLog.uniqueId,
        phoneNumber:
          callLog.phoneNumber && masked ? maskPhone(callLog.phoneNumber) : callLog.phoneNumber,
        startedAt: callLog.startedAt,
        // Talk time net of ring, the same definition the KPI and the reports
        // use (lib/talktime.ts), clamped per row because ring exceeds talk in
        // plenty of production rows.
        netTalkSeconds: Math.max(
          (callLog.talkTimeSeconds ?? 0) - (callLog.ringTimeSeconds ?? 0),
          0,
        ),
        agent: callLog.agent,
        lead: callLog.lead,
        // The upstream URL never reaches the browser — it is unauthenticated
        // and spells out the phone number in its path. The client asks the
        // proxy route for audio and only needs to know whether one exists.
        hasRecording: Boolean(callLog.recordingUrl),
      },
    }));

    return NextResponse.json({
      rows: payload,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      stats: {
        graded,
        flagged,
        fatal,
        avgScore: avg._avg.score === null ? null : Math.round(avg._avg.score * 10) / 10,
        // Ordered best-to-worst, not by count: this is a quality
        // distribution, and reading it left to right should mean reading
        // down the grades. Sorting by count jumbles them.
        byGrade: byGrade
          .filter((g) => g.qaGrade)
          .map((g) => ({ grade: g.qaGrade as string, count: g._count._all }))
          .sort((a, b) => {
            const d = BAND_RANK[gradeBand(a.grade, null)] - BAND_RANK[gradeBand(b.grade, null)];
            return d !== 0 ? d : b.count - a.count;
          }),
      },
      intents: intents.map((i) => i.intent).filter((i): i is string => Boolean(i)),
      lead: leadHeader,
      // Lets the page drop the agent filter and say whose calls these are.
      view: scope.view,
    });
  } catch (error) {
    console.error('[call-analysis GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
