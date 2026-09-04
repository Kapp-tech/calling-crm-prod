import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { KpiPeriod, Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import {
  KPI_SOURCES, KPI_PERIODS, computeKpiActual, kpiPeriodRange, seedDefaultKpisIfEmpty, kpiScore,
  kpiCustomRange, MAX_CUSTOM_RANGE_DAYS, isSnapshotSource,
} from '@/lib/kpi';
import { activeDaysByAgent } from '@/lib/reports';
import { scoreForAgent } from '@/lib/kpi-absence';

/**
 * The KPI page's data: every KPI definition, its organisation-wide targets, and
 * each agent's achievement for the selected period.
 *
 * Targets apply to everyone — there is no per-agent target, so changing an
 * expectation is one edit and a new joiner is measured from their first day.
 *
 * Everyone may read: these are the expectations people are judged against.
 * Only a Super Admin may change definitions or targets.
 */
async function agentScope(viewer: { id: string; role: string }): Promise<Prisma.UserWhereInput | null> {
  if (viewer.role === 'COUNSELLING_AGENT') return { id: viewer.id };
  if (viewer.role === 'COUNSELLING_TL') {
    return {
      role: 'COUNSELLING_AGENT',
      isActive: true,
      OR: [{ managedById: viewer.id }, { team: { teamLeadId: viewer.id } }],
    };
  }
  if (viewer.role === 'SUPER_ADMIN' || viewer.role === 'REPORTS') {
    return { role: 'COUNSELLING_AGENT', isActive: true };
  }
  return null;
}

const periodParam = z.nativeEnum(KpiPeriod).catch('DAILY' as KpiPeriod);
/** An IST calendar date, the form both the date inputs and istDayKey use. */
const dayKeyParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const period = periodParam.parse(params.get('period') ?? 'DAILY');

  // A custom range overrides the named period. Both dates must parse — half a
  // range is treated as none rather than as "from here to whenever", which
  // would quietly report a different window than the one on screen.
  const fromKey = dayKeyParam.safeParse(params.get('from') ?? '');
  const toKey = dayKeyParam.safeParse(params.get('to') ?? '');
  const custom = fromKey.success && toKey.success ? kpiCustomRange(fromKey.data, toKey.data) : null;
  if (custom && custom.days > MAX_CUSTOM_RANGE_DAYS) {
    return NextResponse.json(
      { error: `That range covers ${custom.days} days. Pick ${MAX_CUSTOM_RANGE_DAYS} days or fewer.` },
      { status: 400 },
    );
  }

  try {
    // First visit by an admin populates the defaults so the page is never empty.
    // Guarded on "no definitions at all", so a deliberately emptied list stays
    // empty rather than regrowing.
    if (session.user.role === 'SUPER_ADMIN') {
      await seedDefaultKpisIfEmpty(prisma, session.user.id);
    }

    const [definitions, categories, options, stages] = await Promise.all([
      prisma.kpiDefinition.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { targets: { select: { period: true, target: true, points: true, updatedAt: true, setBy: { select: { name: true } } } } },
      }),
      prisma.feedbackCategory.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.feedbackOption.findMany({
        where: { isActive: true },
        select: { id: true, label: true, categoryId: true },
        orderBy: { label: 'asc' },
      }),
      // Lead Stage choices come from Manage Dropdowns, so the builder offers
      // exactly what the data can actually contain.
      prisma.dropdownOption.findMany({
        where: { type: 'LEAD_STAGE', isActive: true },
        select: { value: true },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    const now = new Date();
    const ranges: Record<string, { label: string }> = {};
    for (const p of KPI_PERIODS) ranges[p.key] = { label: kpiPeriodRange(p.key, now).label };

    const scope = await agentScope(session.user);
    const agents = scope
      ? await prisma.user.findMany({
          where: scope,
          select: { id: true, name: true, employeeCode: true, joiningDate: true },
          orderBy: { name: 'asc' },
        })
      : [];

    // A custom range has no target of its own — targets are stored per named
    // period — so it is measured against the DAILY target multiplied by the days
    // it covers: 300 dialed calls a day over a week is a target of 2,100. Every
    // calendar day counts, Sundays included, so a range spanning a week-off sets
    // a higher bar than the days actually worked.
    //
    // Points are NOT scaled. They are the weight of the KPI, not a quantity of
    // work, so the scoreboard stays out of the same 40 whatever window is shown
    // and a week can be compared with a day.
    const basePeriod: KpiPeriod = custom ? 'DAILY' : period;
    const pointsFor = (d: (typeof definitions)[number]) =>
      d.targets.find((t) => t.period === basePeriod)?.points ?? null;
    const baseTargetFor = (d: (typeof definitions)[number]) =>
      d.targets.find((t) => t.period === basePeriod)?.target ?? null;
    const targetFor = (d: (typeof definitions)[number]) => {
      const base = baseTargetFor(d);
      if (base == null) return null;
      // A snapshot KPI is a live count, not an accumulation, so a longer range
      // does not raise what is being asked for.
      return custom && !isSnapshotSource(d.source) ? base * custom.days : base;
    };

    // The score a full house is worth in this window — the denominator every
    // agent's total is read against. Only scored KPIs (points set) count.
    const maxScore = definitions.reduce((sum, d) => {
      const pts = pointsFor(d);
      return sum + (pts != null && targetFor(d) != null ? pts : 0);
    }, 0);

    /**
     * Days each agent actually worked in the window — days with a follow-up or
     * a dialer call, the same count the emailed Caller-wise report shows.
     *
     * An agent with zero of them was absent, and nothing was expected of them:
     * see `lib/kpi-absence.ts`. The scores are adjusted here so the table, the
     * CSV export and the email cannot disagree about a person who was not
     * there; the targets themselves are per-agent and so are resolved at render
     * from `workingDays`.
     */
    const window = custom ?? kpiPeriodRange(period, now);
    const workedBy = await activeDaysByAgent(
      prisma, agents.map((a) => a.id), window.from, window.to,
    );

    // Achievement for the selected window only — computing all four periods for
    // every agent would be four times the queries for numbers that are not on
    // screen.
    const achievement = await Promise.all(
      agents.map(async (a) => {
        const pairs = await Promise.all(
          definitions.map(
            async (d) => [d.id, await computeKpiActual(prisma, d, a.id, custom ?? period, now)] as const,
          ),
        );
        const actuals = Object.fromEntries(pairs);
        const workingDays = workedBy.get(a.id) ?? 0;
        // scoreForAgent, not kpiScore alone: an absent agent's target is zero
        // and kpiScore reads a zero target as met, awarding the full points.
        const scores = Object.fromEntries(
          definitions.map((d) => [
            d.id,
            scoreForAgent(kpiScore(actuals[d.id], targetFor(d), pointsFor(d)), workingDays),
          ] as const),
        );
        // A null score means "not scored", which must not read as zero — but the
        // total is a sum, so nulls simply contribute nothing.
        const total = Object.values(scores).reduce<number>((sum, v) => sum + (v ?? 0), 0);
        return {
          user: a,
          workingDays,
          actuals,
          scores,
          // Re-rounded: adding one-decimal values repeatedly reintroduces float
          // noise (7.5 + 7.5 + 0.1 style artefacts).
          totalScore: Math.round(total * 10) / 10,
        };
      }),
    );

    const allTargets = definitions.flatMap((d) => d.targets);
    const lastSet = allTargets.reduce<{ at: Date; by: string } | null>((acc, t) => {
      if (!acc || t.updatedAt > acc.at) return { at: t.updatedAt, by: t.setBy?.name ?? 'Unknown' };
      return acc;
    }, null);

    return NextResponse.json({
      definitions: definitions.map((d) => ({
        id: d.id,
        name: d.name,
        unit: d.unit,
        source: d.source,
        feedbackOptionIds: d.feedbackOptionIds,
        feedbackCategoryIds: d.feedbackCategoryIds,
        leadStages: d.leadStages,
        receiptType: d.receiptType,
        isActive: d.isActive,
        sortOrder: d.sortOrder,
        targets: Object.fromEntries(d.targets.map((t) => [t.period, t.target])),
        points: Object.fromEntries(
          d.targets.filter((t) => t.points != null).map((t) => [t.period, t.points as number]),
        ),
      })),
      sources: KPI_SOURCES,
      periods: KPI_PERIODS,
      ranges,
      period,
      custom: custom ? { days: custom.days, label: custom.label } : null,
      // The targets and points the table is actually measured against, resolved
      // here rather than in the browser so the table, the header and the CSV
      // cannot disagree about a scaled number. `base` is the per-day figure the
      // scaling came from, so the page can show its working.
      resolved: {
        targets: Object.fromEntries(definitions.map((d) => [d.id, targetFor(d)])),
        points: Object.fromEntries(definitions.map((d) => [d.id, pointsFor(d)])),
        base: Object.fromEntries(definitions.map((d) => [d.id, baseTargetFor(d)])),
      },
      achievement,
      maxScore,
      choices: { categories, options, leadStages: stages.map((s) => s.value) },
      canEdit: session.user.role === 'SUPER_ADMIN',
      lastSet: lastSet ? { at: lastSet.at.toISOString(), by: lastSet.by } : null,
    });
  } catch (err) {
    console.error('[kpi/targets GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const putSchema = z.object({
  targets: z.array(
    z.object({
      definitionId: z.string().min(1),
      period: z.nativeEnum(KpiPeriod),
      // null clears it. 0 is a real target ("none expected"), so it is kept.
      target: z.number().int().min(0).max(1_000_000).nullable(),
      // null means the KPI is measured but not scored.
      points: z.number().int().min(0).max(10_000).nullable().optional(),
    }),
  ).max(200),
});

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Only a Super Admin can set KPI targets' }, { status: 403 });
  }

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { targets } = parsed.data;

  try {
    await prisma.$transaction(
      targets.map((t) =>
        t.target === null
          ? prisma.kpiTarget.deleteMany({ where: { definitionId: t.definitionId, period: t.period } })
          : prisma.kpiTarget.upsert({
              where: { definitionId_period: { definitionId: t.definitionId, period: t.period } },
              create: {
                definitionId: t.definitionId, period: t.period, target: t.target,
                points: t.points ?? null, setById: session.user.id,
              },
              update: { target: t.target, points: t.points ?? null, setById: session.user.id },
            }),
      ),
    );

    const set = targets.filter((t) => t.target !== null).length;
    await logActivity({
      userId: session.user.id,
      action: 'PERMISSION_CHANGED',
      targetId: 'kpi-targets',
      targetType: 'KpiTarget',
      description: `Updated KPI targets (${set} of ${targets.length} filled)`,
    });

    return NextResponse.json({ success: true, saved: targets.length });
  } catch (err) {
    console.error('[kpi/targets PUT]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
