#!/usr/bin/env node
/**
 * Seed LeadStageEntry for leads that already had a Lead Stage before the table
 * existed.
 *
 * The ingestion API records a history entry every time a lead's stage changes,
 * but leads created before that shipped have no starting point. Their drawer
 * shows either nothing or a single entry for the one change since — which reads
 * as "the history is missing" even though it is working.
 *
 * Two cases:
 *
 *   1. Lead has a stage and NO entries at all
 *      -> insert one entry for its current stage, dated to the lead's own
 *         createdAt. That is the earliest defensible timestamp; the real moment
 *         the stage was set was never recorded.
 *
 *   2. Lead already has entries, and an ActivityLog records the stage it moved
 *      FROM (metadata.from) before the first entry
 *      -> insert that earlier stage, dated just before the first entry, so the
 *         progression reads correctly instead of starting mid-way.
 *
 * Entries created here are marked source='MIGRATED' rather than 'API', so a
 * reconstructed row is never mistaken for one the feed actually sent.
 *
 * Read-only by default. Pass --apply to write.
 *
 *   node scripts/backfill-lead-stage-history.js            # dry run
 *   node scripts/backfill-lead-stage-history.js --apply    # perform it
 *
 * Take a backup before running with --apply.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? '=== APPLY MODE — writing changes ===' : '=== DRY RUN — no changes will be written ===');
  console.log();

  // ── Case 1: leads with a stage but no history at all ──────────────────────
  const withHistory = await prisma.leadStageEntry.findMany({
    select: { leadId: true },
    distinct: ['leadId'],
  });
  const haveHistory = new Set(withHistory.map((e) => e.leadId));

  const candidates = await prisma.lead.findMany({
    where: { leadStage: { not: null } },
    select: { id: true, leadStage: true, createdAt: true },
  });
  const seedFirst = candidates.filter((l) => !haveHistory.has(l.id));

  // ── Case 2: reconstruct the stage a lead moved away from ──────────────────
  const logs = await prisma.activityLog.findMany({
    where: { description: { contains: 'stage updated' } },
    select: { targetId: true, metadata: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  // Only the EARLIEST stage-change per lead tells us where it started. A later
  // one's `from` is a stage we have already recorded, and taking every log
  // produced several reconstructions for one lead, all stamped the same second.
  const earliestLogByLead = new Map();
  for (const log of logs) {
    if (!log.targetId) continue;
    if (!earliestLogByLead.has(log.targetId)) earliestLogByLead.set(log.targetId, log);
  }

  const reconstruct = [];
  for (const log of earliestLogByLead.values()) {
    const meta = log.metadata;
    const from = meta && typeof meta === 'object' ? meta.from : null;
    if (!from) continue;

    const entries = await prisma.leadStageEntry.findMany({
      where: { leadId: log.targetId },
      orderBy: { createdAt: 'asc' },
      select: { stage: true, createdAt: true },
    });
    if (entries.length === 0) continue;               // covered by case 1
    if (entries[0].stage === from) continue;          // already the first entry
    const lead = candidates.find((l) => l.id === log.targetId);
    reconstruct.push({
      leadId: log.targetId,
      stage: from,
      // Just before the first recorded entry, so ordering is unambiguous.
      at: new Date(entries[0].createdAt.getTime() - 1000),
      leadCreatedAt: lead?.createdAt ?? null,
    });
  }

  console.log(`leads with a stage             : ${candidates.length}`);
  console.log(`already have history           : ${candidates.length - seedFirst.length}`);
  console.log(`would get a seeded first entry : ${seedFirst.length}`);
  console.log(`prior stages recoverable from the activity log : ${reconstruct.length}`);
  console.log();

  if (seedFirst.length > 0) {
    console.log('sample of seeded first entries:');
    for (const l of seedFirst.slice(0, 10)) {
      console.log(`  ${l.id.padEnd(10)} ${String(l.leadStage).padEnd(16)} @ ${l.createdAt.toISOString().slice(0, 19)}`);
    }
    if (seedFirst.length > 10) console.log(`  ... and ${seedFirst.length - 10} more`);
    console.log();
  }

  if (reconstruct.length > 0) {
    console.log('reconstructed earlier stages (from ActivityLog metadata.from):');
    for (const r of reconstruct) {
      console.log(`  ${r.leadId.padEnd(10)} ${String(r.stage).padEnd(16)} @ ${r.at.toISOString().slice(0, 19)}`);
    }
    console.log();
  }

  if (!APPLY) {
    console.log('Dry run complete. Re-run with --apply to write these entries.');
    return;
  }

  let done = 0;
  const CHUNK = 500;
  for (let i = 0; i < seedFirst.length; i += CHUNK) {
    const chunk = seedFirst.slice(i, i + CHUNK);
    await prisma.leadStageEntry.createMany({
      data: chunk.map((l) => ({
        leadId: l.id,
        stage: l.leadStage,
        source: 'MIGRATED',
        createdAt: l.createdAt,
      })),
    });
    done += chunk.length;
    console.log(`  seeded ${done}/${seedFirst.length}`);
  }

  if (reconstruct.length > 0) {
    await prisma.leadStageEntry.createMany({
      data: reconstruct.map((r) => ({
        leadId: r.leadId,
        stage: r.stage,
        source: 'MIGRATED',
        createdAt: r.at,
      })),
    });
    console.log(`  reconstructed ${reconstruct.length} earlier stage(s)`);
  }

  console.log();
  console.log(`Backfill complete — ${done + reconstruct.length} entries created.`);
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
