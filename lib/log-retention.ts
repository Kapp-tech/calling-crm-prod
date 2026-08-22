import { Prisma, PrismaClient } from '@prisma/client';
import { istDayKey, istStartOfDay, toUtcSqlTimestamp } from './ist-time';

/**
 * Trimming the log tables.
 *
 * `ActivityLog` and `EmailLog` are append-only and grow forever. Neither is read
 * beyond a few weeks back, so anything past the retention window is dead weight
 * in every backup, every restore and every sequential scan.
 *
 * Deletion is deliberately **batched**. A single `DELETE` over hundreds of
 * thousands of rows takes a long lock and builds one enormous transaction; on a
 * 1 GB box that is how a routine tidy-up becomes an outage. Small batches commit
 * as they go, so the table is never locked for long and the work is resumable.
 */

/** Months of history to keep. Whole calendar months, so "3" means 3 months. */
export function retentionMonths(): number {
  const raw = Number(process.env.LOG_RETENTION_MONTHS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 3;
}

/** Rows created before this instant are eligible for deletion. */
export function retentionCutoff(now = new Date(), months = retentionMonths()): Date {
  const [y, m, d] = istDayKey(now).split('-').map(Number);
  // Day-of-month is clamped so 31 May minus 3 months lands on 28/29 February
  // rather than rolling forward into March and keeping a month too little.
  const targetMonth = m - months;
  const year = y + Math.floor((targetMonth - 1) / 12);
  const month = ((targetMonth - 1 + 12000) % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return istStartOfDay(
    `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
  );
}

const BATCH = 5_000;
/** Stops a runaway loop; at 5k a batch this is 5 million rows in one run. */
const MAX_BATCHES = 1_000;

export interface PurgeResult {
  table: string;
  cutoff: string;
  eligible: number;
  deleted: number;
  batches: number;
}

async function purgeTable(
  db: PrismaClient,
  table: 'ActivityLog' | 'EmailLog',
  column: 'createdAt' | 'sentAt',
  cutoff: Date,
  apply: boolean,
): Promise<PurgeResult> {
  // An explicit UTC literal, never a JS Date: the driver serialises a Date in
  // the Node process's timezone and casting that to `timestamp without time
  // zone` silently drops the offset, which here would shift the cutoff by 5h30m
  // and delete rows that should have been kept. See toUtcSqlTimestamp.
  const bound = toUtcSqlTimestamp(cutoff);

  const [{ count }] = await db.$queryRaw<{ count: bigint }[]>(
    Prisma.sql`SELECT count(*)::bigint AS count FROM ${Prisma.raw(`"${table}"`)}
               WHERE ${Prisma.raw(`"${column}"`)} < ${bound}::timestamp`,
  );
  const eligible = Number(count);

  const result: PurgeResult = { table, cutoff: bound, eligible, deleted: 0, batches: 0 };
  if (!apply || eligible === 0) return result;

  for (let i = 0; i < MAX_BATCHES; i += 1) {
    // The subquery is what gives DELETE a LIMIT, which plain SQL lacks. Both
    // tables already carry an index on the timestamp column, so each batch is
    // an index scan rather than a full sweep.
    const removed = await db.$executeRaw(
      Prisma.sql`DELETE FROM ${Prisma.raw(`"${table}"`)}
                 WHERE id IN (
                   SELECT id FROM ${Prisma.raw(`"${table}"`)}
                   WHERE ${Prisma.raw(`"${column}"`)} < ${bound}::timestamp
                   LIMIT ${BATCH}
                 )`,
    );
    result.deleted += removed;
    result.batches += 1;
    if (removed < BATCH) break;
  }
  return result;
}

/**
 * Deletes log rows past the retention window.
 *
 * Read-only unless `apply` is true, so the same call reports what *would* go
 * before anything is removed — this is irreversible and there is no undo.
 */
export async function purgeOldLogs(
  db: PrismaClient,
  { apply, now = new Date() }: { apply: boolean; now?: Date },
): Promise<{ cutoff: string; months: number; results: PurgeResult[] }> {
  const months = retentionMonths();
  const cutoff = retentionCutoff(now, months);

  const results = [
    await purgeTable(db, 'ActivityLog', 'createdAt', cutoff, apply),
    await purgeTable(db, 'EmailLog', 'sentAt', cutoff, apply),
  ];

  return { cutoff: toUtcSqlTimestamp(cutoff), months, results };
}
