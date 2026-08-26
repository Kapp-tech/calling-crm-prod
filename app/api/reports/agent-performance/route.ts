import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { buildAgentReport, buildFeedbackBreakdown, buildCollegeBreakdown, summariseAgentRows, ReportRange } from '@/lib/reports';
import { KPI_PERIODS, computeKpiActual } from '@/lib/kpi';

/**
 * The Reports dashboards.
 *
 * One endpoint serves all three views because they are the same report at
 * different scopes — an agent sees themselves, a TL their team, a manager
 * everyone. Deriving the scope from the session rather than a parameter means a
 * TL cannot widen their view by editing the request.
 *
 * `agentIds` and `tlIds` only ever *narrow* what the session already permits.
 */

/** Comma-separated ids from the multi-select filters; blanks are dropped so an
 * empty selection is indistinguishable from the parameter being absent. */
const idList = z
  .string()
  .optional()
  .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : []));

const querySchema = z.object({
  range: z.enum(['DATEWISE', 'WEEKLY', 'OVERALL']).default('DATEWISE'),
  from: z.string().optional(),
  to: z.string().optional(),
  agentIds: idList,
  tlIds: idList,
});

/** A TL owns an agent either through `managedById` or by leading their team —
 * this CRM uses both, so every TL filter has to check the pair. */
function underTls(tlIds: string[]): Prisma.UserWhereInput {
  return {
    OR: tlIds.flatMap((id) => [
      { managedById: id } as Prisma.UserWhereInput,
      { team: { teamLeadId: id } } as Prisma.UserWhereInput,
    ]),
  };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { range, from, to, agentIds, tlIds } = parsed.data;

  const role = session.user.role;
  const view = role === 'COUNSELLING_AGENT' ? 'agent' : role === 'COUNSELLING_TL' ? 'team' : 'manager';

  // The widest set this session may ever see. Narrowing filters are ANDed on.
  let scope: Prisma.UserWhereInput;
  if (view === 'agent') {
    scope = { id: session.user.id };
  } else if (view === 'team') {
    scope = {
      role: 'COUNSELLING_AGENT',
      isActive: true,
      OR: [{ managedById: session.user.id }, { team: { teamLeadId: session.user.id } }],
    };
  } else if (role === 'SUPER_ADMIN' || role === 'REPORTS') {
    scope = { role: 'COUNSELLING_AGENT', isActive: true };
  } else {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // An agent's own view ignores both filters — there is nothing to narrow to.
  // Only a manager has a TL filter; a TL is already scoped to their own team.
  const tlFilter = view === 'manager' && tlIds.length > 0 ? underTls(tlIds) : null;

  // What "Team totals" covers: the TL filter applies, the agent filter does not.
  // Picking one agent out of a team should not silently redefine the team.
  const summaryWhere: Prisma.UserWhereInput = tlFilter ? { AND: [scope, tlFilter] } : scope;

  const narrowed: Prisma.UserWhereInput[] = [scope];
  if (tlFilter) narrowed.push(tlFilter);
  if (view !== 'agent' && agentIds.length > 0) narrowed.push({ id: { in: agentIds } });
  const agentWhere: Prisma.UserWhereInput = narrowed.length === 1 ? scope : { AND: narrowed };

  try {
    const now = new Date();
    const { rows, label } = await buildAgentReport(prisma, agentWhere, range as ReportRange, from, to, now);

    // The TL/manager summary ignores the agent filter, so it stays a team total
    // while individual agents are selected in the detail table above it. It does
    // follow the TL filter — "totals for the teams I picked" is the useful read.
    const summarySource =
      view === 'agent'
        ? rows
        : (await buildAgentReport(prisma, summaryWhere, range as ReportRange, from, to, now)).rows;

    /**
     * The feedback summary is a book-of-work total, not an agent-performance
     * table, so an unfiltered manager view counts every follow-up in the window
     * whoever logged it — `{}` matches all users.
     *
     * The agent-performance scope above is deliberately
     * `COUNSELLING_AGENT + isActive`, and inheriting it here was wrong twice
     * over: a follow-up logged by a Super Admin or a TL vanished, and so did the
     * entire history of any agent who has since been deactivated, which would
     * quietly shrink an Overall report every time someone left. It also made the
     * table disagree with the All Leads pills, which do not care who logged the
     * follow-up.
     *
     * Narrowing still wins: pick a TL or an agent and the summary follows, so a
     * filter never appears to do nothing. Permission is unaffected — only
     * SUPER_ADMIN and REPORTS ever reach the manager view.
     */
    const unfilteredManagerView = view === 'manager' && !tlFilter && agentIds.length === 0;
    const breakdownWhere: Prisma.UserWhereInput = unfilteredManagerView ? {} : agentWhere;

    // Same scope and the same counting rule for both, so the college table's
    // Dialed column totals to exactly the feedback summary's Total.
    const [feedbackBreakdown, collegeBreakdown] = await Promise.all([
      buildFeedbackBreakdown(prisma, breakdownWhere, range as ReportRange, from, to, now),
      buildCollegeBreakdown(prisma, breakdownWhere, range as ReportRange, from, to, now),
    ]);

    // Benchmarking: the KPI targets are organisation-wide, so each agent is
    // measured against the same numbers. Only shown for a single agent, where
    // "target vs achieved" is meaningful.
    let benchmarking: {
      kpi: string; unit: string; period: string; target: number; actual: number | null; pct: number | null;
    }[] = [];
    const soloAgentId = view === 'agent' ? session.user.id : rows.length === 1 ? rows[0].id : null;
    if (soloAgentId) {
      const defs = await prisma.kpiDefinition.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { targets: true },
      });
      // Map the report window onto the closest KPI period so the comparison is
      // like-for-like: a weekly report is judged against the weekly target.
      const kpiPeriod = range === 'WEEKLY' ? 'WEEKLY' : range === 'OVERALL' ? 'MONTHLY' : 'DAILY';
      benchmarking = (
        await Promise.all(
          defs.map(async (d) => {
            const t = d.targets.find((x) => x.period === kpiPeriod);
            if (!t) return null;
            const actual = await computeKpiActual(prisma, d, soloAgentId, kpiPeriod, now);
            return {
              kpi: d.name,
              unit: d.unit,
              period: KPI_PERIODS.find((p) => p.key === kpiPeriod)?.label ?? kpiPeriod,
              target: t.target,
              actual,
              pct: actual === null || t.target <= 0 ? null : Math.round((actual / t.target) * 100),
            };
          }),
        )
      ).filter(Boolean) as typeof benchmarking;
    }

    // Filter choices, limited to what this session may narrow to. The agent list
    // follows the TL filter, so picking a Team Leader leaves only their agents
    // to choose from rather than the whole organisation.
    const [agentChoices, tlChoices] = await Promise.all([
      view === 'agent'
        ? Promise.resolve([])
        : prisma.user.findMany({
            where: summaryWhere,
            select: { id: true, name: true, employeeCode: true },
            orderBy: { name: 'asc' },
          }),
      view === 'manager'
        ? prisma.user.findMany({
            where: { role: 'COUNSELLING_TL', isActive: true },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([]),
    ]);

    return NextResponse.json({
      view,
      range,
      label,
      rows,
      summary: summariseAgentRows(summarySource),
      feedbackBreakdown,
      collegeBreakdown,
      benchmarking,
      choices: { agents: agentChoices, tls: tlChoices },
    });
  } catch (err) {
    console.error('[reports/agent-performance GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
