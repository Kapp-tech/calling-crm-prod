import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission } from '@/lib/permissions';
import { Feature } from '@prisma/client';

const ALLOWED_DIMS = ['agent', 'feedback', 'state', 'city', 'college', 'campaign', 'leadType'] as const;
type Dim = typeof ALLOWED_DIMS[number];

// SELECT fragments per dimension
const DIM_SELECT: Record<Dim, string> = {
  agent:    'u.id AS "agentId", u.name AS "agentName"',
  feedback: 'fo.id AS "feedbackId", fo.label AS "feedbackLabel"',
  state:    'COALESCE(l.state, \'—\') AS "state"',
  city:     'COALESCE(l.city, \'—\') AS "city"',
  college:  'COALESCE(l.college, \'—\') AS "college"',
  campaign: 'COALESCE(l.campaign, \'—\') AS "campaign"',
  leadType: 'COALESCE(l."leadType", \'—\') AS "leadType"',
};

// GROUP BY fragments per dimension
const DIM_GROUP: Record<Dim, string> = {
  agent:    'u.id, u.name',
  feedback: 'fo.id, fo.label',
  state:    'COALESCE(l.state, \'—\')',
  city:     'COALESCE(l.city, \'—\')',
  college:  'COALESCE(l.college, \'—\')',
  campaign: 'COALESCE(l.campaign, \'—\')',
  leadType: 'COALESCE(l."leadType", \'—\')',
};

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || !(await hasPermission(session.user.role, Feature.VIEW_REPORTS))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sp = new URL(req.url).searchParams;
    const from            = sp.get('from');
    const to              = sp.get('to');
    const teamId          = sp.get('teamId');
    const agentId         = sp.get('agentId');
    const workTypeVal     = sp.get('workType');
    const feedbackOptId   = sp.get('feedbackOptionId');
    const stateVal        = sp.get('state');
    const cityVal         = sp.get('city');
    const collegeVal      = sp.get('college');
    const campaignVal     = sp.get('campaign');
    const leadTypeVal     = sp.get('leadType');

    const rawDims = sp.get('groupBy')?.split(',').filter(Boolean) ?? [];
    const dims = rawDims.filter((d): d is Dim => ALLOWED_DIMS.includes(d as Dim));
    if (dims.length === 0) dims.push('agent');

    // TL: always scoped to their own team
    let effectiveTeamId = teamId;
    if (session.user.role === 'COUNSELLING_TL') {
      const tl = await prisma.user.findUnique({ where: { id: session.user.id }, select: { teamId: true } });
      effectiveTeamId = tl?.teamId ?? null;
    }

    // Build parameterised WHERE
    const conditions: string[] = [];
    const params: unknown[]    = [];
    let n = 1;

    const p = () => `$${n++}`;

    if (from) {
      conditions.push(`lf."createdAt" >= ${p()}`);
      params.push(new Date(from));
    }
    if (to) {
      conditions.push(`lf."createdAt" <= ${p()}`);
      params.push(new Date(`${to}T23:59:59.999Z`));
    }
    if (effectiveTeamId) {
      conditions.push(`u."teamId" = ${p()}`);
      params.push(effectiveTeamId);
    }
    if (agentId) {
      conditions.push(`lf."agentId" = ${p()}`);
      params.push(agentId);
    }
    if (workTypeVal === 'WFH' || workTypeVal === 'WFO') {
      conditions.push(`u."workType" = ${p()}`);
      params.push(workTypeVal);
    }
    if (feedbackOptId) {
      conditions.push(`lf."feedbackOptionId" = ${p()}`);
      params.push(feedbackOptId);
    }
    if (stateVal) {
      conditions.push(`l.state = ${p()}`);
      params.push(stateVal);
    }
    if (cityVal) {
      conditions.push(`l.city = ${p()}`);
      params.push(cityVal);
    }
    if (collegeVal) {
      conditions.push(`l.college = ${p()}`);
      params.push(collegeVal);
    }
    if (campaignVal) {
      conditions.push(`l.campaign = ${p()}`);
      params.push(campaignVal);
    }
    if (leadTypeVal) {
      conditions.push(`l."leadType" = ${p()}`);
      params.push(leadTypeVal);
    }

    const WHERE = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const selectCols = dims.map((d) => DIM_SELECT[d]).join(', ');
    const groupCols  = dims.map((d) => DIM_GROUP[d]).join(', ');

    const BASE_JOIN = `
      FROM "LeadFeedback" lf
      JOIN "User" u  ON u.id  = lf."agentId"
      JOIN "FeedbackOption" fo ON fo.id = lf."feedbackOptionId"
      JOIN "Lead" l  ON l.id  = lf."leadId"
    `;

    const dataSQL = `
      SELECT ${selectCols},
        COUNT(lf.id)::int           AS "callCount",
        COUNT(DISTINCT lf."leadId")::int AS "uniqueLeads"
      ${BASE_JOIN}
      ${WHERE}
      GROUP BY ${groupCols}
      ORDER BY "callCount" DESC
      LIMIT 2000
    `;

    const summarySQL = `
      SELECT
        COUNT(lf.id)::int                    AS "totalCalls",
        COUNT(DISTINCT lf."leadId")::int     AS "uniqueLeads",
        COUNT(DISTINCT lf."agentId")::int    AS "activeAgents",
        COUNT(DISTINCT l.state)::int         AS "uniqueStates",
        COUNT(DISTINCT l.city)::int          AS "uniqueCities",
        COUNT(DISTINCT l.college)::int       AS "uniqueColleges"
      ${BASE_JOIN}
      ${WHERE}
    `;

    const [rows, summaryRows] = await Promise.all([
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(dataSQL, ...params),
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(summarySQL, ...params),
    ]);

    const s = summaryRows[0] ?? {};

    return NextResponse.json({
      summary: {
        totalCalls:     Number(s.totalCalls    ?? 0),
        uniqueLeads:    Number(s.uniqueLeads   ?? 0),
        activeAgents:   Number(s.activeAgents  ?? 0),
        uniqueStates:   Number(s.uniqueStates  ?? 0),
        uniqueCities:   Number(s.uniqueCities  ?? 0),
        uniqueColleges: Number(s.uniqueColleges ?? 0),
      },
      rows: rows.map((r) => ({
        ...r,
        callCount:   Number(r.callCount),
        uniqueLeads: Number(r.uniqueLeads),
      })),
      dims,
    });
  } catch (err) {
    console.error('[reports/analytics GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
