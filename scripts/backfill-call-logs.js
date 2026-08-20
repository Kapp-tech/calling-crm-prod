/**
 * Re-parses stored CallLog rows from their raw `payload`.
 *
 * Why this exists: the first version of the webhook parser followed DialShree's
 * documented sample, which nests `uniqueid` and `user` inside `dynamic_data`.
 * The live feed sends `dynamic_data` as an empty string and puts both at the top
 * level, so early rows landed with no dialer id (no de-duplication) and no seat
 * (attributed to no agent). It also predates the `call_status` columns.
 *
 * Nothing was lost, because the whole body is stored verbatim — this reads it
 * back and fills in what the fixed parser now understands.
 *
 * Read-only unless given --apply. Run from the project root:
 *   node scripts/backfill-call-logs.js            # dry run
 *   node scripts/backfill-call-logs.js --apply
 */
const { PrismaClient } = require('@prisma/client');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// The parser is TypeScript and is the single source of truth for reading these
// payloads — duplicating it here is how a backfill quietly disagrees with the
// live webhook. Compile it to a throwaway CommonJS build instead.
const TMP = path.join(__dirname, '..', '.backfill-build');
function loadParser() {
  execFileSync(
    'npx',
    ['tsc', 'lib/dialshree-webhook.ts', 'lib/ist-time.ts',
     '--outDir', TMP, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
    { cwd: path.join(__dirname, '..'), stdio: 'pipe' },
  );
  return require(path.join(TMP, 'dialshree-webhook.js'));
}

const { parseDialerCall, connectedFrom } = loadParser();

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.callLog.findMany({
    select: {
      id: true, uniqueId: true, agentSeat: true, agentId: true, leadId: true,
      callStatus: true, connected: true, phoneNumber: true, payload: true,
    },
    orderBy: { receivedAt: 'asc' },
  });
  console.log(`${rows.length} call log row(s) to inspect\n`);

  let changed = 0;
  const clashes = [];

  for (const row of rows) {
    let facts;
    try {
      facts = parseDialerCall(row.payload);
    } catch (err) {
      console.log(`  ${row.id}  SKIP — payload no longer parses: ${err.message}`);
      continue;
    }

    const update = {};
    // Only fill gaps. A value already stored was written by a later, correct
    // run of the webhook and must not be overwritten from an older payload.
    if (!row.uniqueId && facts.uniqueId) update.uniqueId = facts.uniqueId;
    if (!row.agentSeat && facts.agentSeat) update.agentSeat = facts.agentSeat;
    if (row.callStatus === null && facts.callStatus) update.callStatus = facts.callStatus;
    if (row.connected === null) {
      const c = connectedFrom(facts.callStatus, facts.talkTimeSeconds);
      if (c !== null) update.connected = c;
    }
    if (facts.termReason) update.termReason = facts.termReason;
    if (facts.dispositionDescription) update.dispositionDescription = facts.dispositionDescription;
    if (facts.dialerLeadId) update.dialerLeadId = facts.dialerLeadId;

    // Re-attempt the matches that failed only because the seat was missing.
    const seat = update.agentSeat ?? row.agentSeat;
    if (!row.agentId && seat) {
      const agent = await prisma.user.findUnique({ where: { dialshreeId: seat }, select: { id: true } });
      if (agent) update.agentId = agent.id;
    }
    if (!row.leadId) {
      const agentId = update.agentId ?? row.agentId;
      const lead =
        (agentId
          ? await prisma.lead.findFirst({
              where: { phone: facts.phoneKey, assignedToId: agentId },
              orderBy: { updatedAt: 'desc' }, select: { id: true },
            })
          : null) ??
        (await prisma.lead.findFirst({
          where: { phone: facts.phoneKey },
          orderBy: { updatedAt: 'desc' }, select: { id: true },
        }));
      if (lead) update.leadId = lead.id;
    }

    if (Object.keys(update).length === 0) continue;

    // uniqueId is unique. If two early rows are the same call stored twice
    // (a retry before de-duplication worked), setting it would violate the
    // constraint — report those instead of failing the run.
    if (update.uniqueId) {
      const existing = await prisma.callLog.findFirst({
        where: { uniqueId: update.uniqueId, id: { not: row.id } },
        select: { id: true },
      });
      if (existing) {
        clashes.push({ row: row.id, duplicateOf: existing.id, uniqueId: update.uniqueId });
        delete update.uniqueId;
        if (Object.keys(update).length === 0) continue;
      }
    }

    changed += 1;
    console.log(`  ${row.id}  ${JSON.stringify(update)}`);
    if (APPLY) await prisma.callLog.update({ where: { id: row.id }, data: update });
  }

  console.log(`\n${changed} row(s) ${APPLY ? 'updated' : 'would be updated'}`);
  if (clashes.length) {
    console.log(`\n${clashes.length} apparent duplicate call(s) — same dialer uniqueid stored twice`);
    console.log('These are calls the dialer re-sent before de-duplication worked.');
    console.log('Left alone; delete the newer row by hand if you want them merged:');
    for (const c of clashes) console.log(`  ${c.row} duplicates ${c.duplicateOf} (uniqueid ${c.uniqueId})`);
  }
  if (!APPLY) console.log('\nDry run. Re-run with --apply to write.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => {
    prisma.$disconnect();
    fs.rmSync(TMP, { recursive: true, force: true });
  });
