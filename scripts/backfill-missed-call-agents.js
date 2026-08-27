/**
 * Attributes already-stored missed calls to their agent.
 *
 * The webhook now reads the seat out of the `sticky<dialshreeId>` tag, but that
 * only helps calls that arrive from now on. Rows already in CallLog were saved
 * with `agentSeat` taken from the dialer's `user` field, which on an inbound
 * abandoned call is the trunk ("VDCL") rather than an agent — so every one of
 * them sits unattributed and an agent's Missed tab, scoped to their own id,
 * shows nothing at all.
 *
 * The raw webhook body was kept on every row, so the seat can be recovered
 * without asking DialShree to resend anything.
 *
 * Read-only unless given --apply.
 *
 *   node scripts/backfill-missed-call-agents.js            # report
 *   node scripts/backfill-missed-call-agents.js --apply    # write
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** Same rule as lib/dialshree-webhook.ts — security_phrase first, then campaign. */
function stickySeat(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ['security_phrase', 'campaign']) {
    const raw = typeof payload[key] === 'string' ? payload[key].trim() : '';
    const m = /^sticky(\d+)$/i.exec(raw);
    if (m) return m[1];
  }
  return null;
}

(async () => {
  const rows = await prisma.callLog.findMany({
    where: { termReason: { equals: 'ABANDON', mode: 'insensitive' }, agentId: null },
    select: { id: true, payload: true, agentSeat: true },
  });

  const seats = new Map();
  for (const r of rows) {
    const seat = stickySeat(r.payload);
    if (seat) seats.set(r.id, seat);
  }

  const users = await prisma.user.findMany({
    where: { dialshreeId: { in: Array.from(new Set(seats.values())) } },
    select: { id: true, name: true, dialshreeId: true },
  });
  const bySeat = new Map(users.map((u) => [u.dialshreeId, u]));

  const perAgent = new Map();
  let resolvable = 0;
  for (const [, seat] of seats) {
    const u = bySeat.get(seat);
    if (!u) continue;
    resolvable += 1;
    perAgent.set(u.name, (perAgent.get(u.name) ?? 0) + 1);
  }

  console.log(`unattributed ABANDON rows : ${rows.length}`);
  console.log(`  carry a sticky seat     : ${seats.size}`);
  console.log(`  seat maps to a CRM user : ${resolvable}`);
  console.log(`  will stay unattributed  : ${rows.length - resolvable}`);
  console.log('');
  for (const [name, n] of [...perAgent.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${name.padEnd(20)} ${n}`);
  }

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.');
    return;
  }

  // Grouped by seat so this is one UPDATE per agent rather than one per row.
  let updated = 0;
  for (const [seat, user] of bySeat) {
    const ids = Array.from(seats.entries()).filter(([, s]) => s === seat).map(([id]) => id);
    if (ids.length === 0) continue;
    const res = await prisma.callLog.updateMany({
      where: { id: { in: ids } },
      // agentSeat is corrected too, so the row shows the seat it belongs to
      // rather than the trunk it happened to arrive on.
      data: { agentId: user.id, agentSeat: seat },
    });
    updated += res.count;
  }
  console.log(`\nUpdated ${updated} rows.`);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
