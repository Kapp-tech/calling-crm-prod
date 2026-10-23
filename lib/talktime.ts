import { Prisma, PrismaClient } from '@prisma/client';
import { toUtcSqlTimestamp } from '@/lib/ist-time';

/**
 * Talk time, net of ringing.
 *
 * The dialer reports `talk_time` and `ring_time` separately, and its talk
 * figure includes the ringing — so the time an agent actually spent speaking
 * is the difference. Everything that reports "talk time" uses this, because
 * the KPI and the Overall Calling Report are measured against the SAME daily
 * mandate: if they computed it differently, one screen would say the target
 * was met and the other that it was missed.
 *
 * GREATEST(..., 0) per row, and that clamp is load-bearing rather than
 * defensive. The provider's data regularly reports ring equal to or greater
 * than talk — the schema notes a 12-second call with 17 seconds of ring time,
 * and production rows show pairs like 13/15 and 11/12. Without the clamp those
 * rows contribute a negative, silently eating real minutes from other calls in
 * the same SUM, so an agent's total could fall as they worked.
 *
 * NULLs coalesce to 0: a missing ring time means nothing to subtract, not
 * "discard this call".
 */
export const NET_TALK_SECONDS = Prisma.sql`
  GREATEST(COALESCE("talkTimeSeconds", 0) - COALESCE("ringTimeSeconds", 0), 0)
`;

/** Window clause for a CallLog query on `startedAt`, or empty when unbounded. */
function startedAtClause(from: Date | null, to: Date | null): Prisma.Sql {
  return Prisma.sql`
    ${from ? Prisma.sql`AND c."startedAt" >= ${toUtcSqlTimestamp(from)}::timestamp` : Prisma.empty}
    ${to ? Prisma.sql`AND c."startedAt" <= ${toUtcSqlTimestamp(to)}::timestamp` : Prisma.empty}
  `;
}

/**
 * Whole net minutes for one agent in a window.
 *
 * Floored, not rounded: a 60-minute target should not be met by 59m31s.
 */
export async function netTalkMinutesForAgent(
  db: PrismaClient,
  agentId: string,
  from: Date | null,
  to: Date | null,
): Promise<number> {
  const rows = await db.$queryRaw<{ seconds: bigint | null }[]>(Prisma.sql`
    SELECT COALESCE(SUM(${NET_TALK_SECONDS}), 0)::bigint AS seconds
    FROM "CallLog" c
    WHERE c."agentId" = ${agentId}
    ${startedAtClause(from, to)}
  `);
  return Math.floor(Number(rows[0]?.seconds ?? 0) / 60);
}

/** Whole net minutes per agent, for a set of agents. */
export async function netTalkMinutesByAgent(
  db: PrismaClient,
  agentIds: string[],
  from: Date | null,
  to: Date | null,
): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ agentId: string; seconds: bigint | null }[]>(Prisma.sql`
    SELECT c."agentId" AS "agentId", COALESCE(SUM(${NET_TALK_SECONDS}), 0)::bigint AS seconds
    FROM "CallLog" c
    WHERE c."agentId" IN (${Prisma.join(agentIds)})
    ${startedAtClause(from, to)}
    GROUP BY c."agentId"
  `);
  return new Map(rows.map((r) => [r.agentId, Math.floor(Number(r.seconds ?? 0) / 60)]));
}

/**
 * Average net talk time per CONNECTED call, in minutes to one decimal.
 *
 * Only calls the dialer itself marked CONNECTED, and only those with talk time
 * left after subtracting the ring: averaging the rest drags every agent toward
 * zero and makes a busy day look quiet. A total is barely affected by those
 * calls, which is why the sums above do not filter them out.
 */
export async function avgNetTalkMinutesByAgent(
  db: PrismaClient,
  agentIds: string[],
  from: Date | null,
  to: Date | null,
): Promise<Map<string, number>> {
  if (agentIds.length === 0) return new Map();
  const rows = await db.$queryRaw<{ agentId: string; avg: number | null }[]>(Prisma.sql`
    SELECT c."agentId" AS "agentId", AVG(${NET_TALK_SECONDS})::float AS avg
    FROM "CallLog" c
    WHERE c."agentId" IN (${Prisma.join(agentIds)})
      AND c."connected" = true
      AND ${NET_TALK_SECONDS} > 0
    ${startedAtClause(from, to)}
    GROUP BY c."agentId"
  `);
  return new Map(
    rows
      .filter((r) => r.avg != null)
      // One decimal — more would imply precision the dialer's MM:SS strings
      // do not carry.
      .map((r) => [r.agentId, Math.round((r.avg! / 60) * 10) / 10]),
  );
}
