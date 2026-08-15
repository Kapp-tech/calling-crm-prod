#!/usr/bin/env node
/**
 * Backfill Lead.updatedAt so it means "when feedback was last submitted".
 *
 * Lead.updatedAt used to be Prisma's `@updatedAt`, so ANY write bumped it —
 * most damagingly lib/team-sync.ts, which rewrites `teamId` on every lead an
 * agent owns when that agent moves to a different Team Lead. That restamped
 * hundreds of leads to the same instant and buried real call activity.
 *
 * The column is no longer `@updatedAt` (see prisma/schema.prisma) and is now
 * advanced only by app/api/leads/[id]/feedback/route.ts. Rows written BEFORE
 * that change still carry the old incidental timestamps, and nothing will
 * correct them until each lead next receives feedback. This script rewrites
 * history to match the new meaning:
 *
 *   - lead has feedback  -> updatedAt = most recent LeadFeedback.createdAt
 *   - lead has none      -> updatedAt = the lead's own createdAt
 *
 * Read-only by default. Pass --apply to write.
 *
 *   node scripts/backfill-lead-updated-at.js            # dry run, changes nothing
 *   node scripts/backfill-lead-updated-at.js --apply    # perform the backfill
 *
 * Take a backup before running with --apply.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function iso(d) {
  return d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '(none)';
}

async function main() {
  console.log(APPLY ? '=== APPLY MODE — writing changes ===' : '=== DRY RUN — no changes will be written ===');
  console.log();

  const leads = await prisma.lead.findMany({
    select: {
      id: true,
      createdAt: true,
      updatedAt: true,
      feedbacks: {
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const planned = [];
  for (const lead of leads) {
    // The lead's real "last activity": its newest feedback, or failing that the
    // moment it was created. Never invent a time that isn't already in the data.
    const target = lead.feedbacks[0]?.createdAt ?? lead.createdAt;
    // Sub-second differences are noise from the old auto-stamp; ignore them.
    if (Math.abs(new Date(lead.updatedAt) - new Date(target)) < 1000) continue;
    planned.push({
      id: lead.id,
      from: lead.updatedAt,
      to: target,
      source: lead.feedbacks[0] ? 'latest feedback' : 'lead createdAt (no feedback)',
    });
  }

  console.log(`leads scanned          : ${leads.length}`);
  console.log(`already correct        : ${leads.length - planned.length}`);
  console.log(`would be corrected     : ${planned.length}`);
  const withFb = planned.filter((p) => p.source === 'latest feedback').length;
  console.log(`  from latest feedback : ${withFb}`);
  console.log(`  from lead createdAt  : ${planned.length - withFb}`);
  console.log();

  if (planned.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  console.log('sample of the changes:');
  for (const p of planned.slice(0, 15)) {
    console.log(`  ${p.id.padEnd(10)} ${iso(p.from)} -> ${iso(p.to)}   (${p.source})`);
  }
  if (planned.length > 15) console.log(`  ... and ${planned.length - 15} more`);
  console.log();

  if (!APPLY) {
    console.log('Dry run complete. Re-run with --apply to write these changes.');
    return;
  }

  let done = 0;
  // Chunked rather than one big transaction: this runs against a 1GB-RAM
  // production box, and a single transaction over every lead would hold locks
  // far longer than necessary.
  const CHUNK = 200;
  for (let i = 0; i < planned.length; i += CHUNK) {
    const chunk = planned.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((p) =>
        prisma.lead.update({ where: { id: p.id }, data: { updatedAt: p.to } })
      )
    );
    done += chunk.length;
    console.log(`  updated ${done}/${planned.length}`);
  }

  console.log();
  console.log(`Backfill complete — ${done} leads corrected.`);
}

main()
  .catch((e) => {
    console.error('ERROR:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
