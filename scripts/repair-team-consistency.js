/**
 * Repairs agents whose Team Lead fields drifted apart before lib/team-sync.ts
 * existed — i.e. rows where User.managedById names one TL while User.teamId
 * belongs to a different TL's team, plus leads whose team stamp no longer
 * matches the team their assignee is actually in.
 *
 * Treats User.managedById (the "Manager" chosen in User Management) as the
 * intended answer, because that is the field an admin last set deliberately;
 * teamId and the agents' Lead.teamId stamps are brought into line with it.
 *
 * Read-only by default. Run with --apply to write:
 *   node scripts/repair-team-consistency.js            # dry run, changes nothing
 *   node scripts/repair-team-consistency.js --apply    # perform the repair
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

(async () => {
  const teams = await prisma.team.findMany({
    select: { id: true, name: true, teamLeadId: true },
  });
  const teamByLead = new Map(teams.filter((t) => t.teamLeadId).map((t) => [t.teamLeadId, t]));
  const teamById = new Map(teams.map((t) => [t.id, t]));

  const agents = await prisma.user.findMany({
    where: { role: 'COUNSELLING_AGENT' },
    select: {
      id: true, name: true, employeeCode: true, managedById: true, teamId: true,
      managedBy: { select: { name: true } },
      _count: { select: { assignedLeads: true } },
    },
    orderBy: { employeeCode: 'asc' },
  });

  console.log(APPLY ? '=== APPLYING REPAIR ===' : '=== DRY RUN (no changes will be written) ===');
  console.log('');

  let userFixes = 0;
  let leadFixes = 0;

  for (const a of agents) {
    // The team the agent SHOULD be in, based on who manages them.
    const shouldTeam = a.managedById ? (teamByLead.get(a.managedById) ?? null) : null;
    const shouldTeamId = shouldTeam?.id ?? null;

    const userDrift = a.teamId !== shouldTeamId;

    // Leads assigned to this agent that carry the wrong team stamp. NULL has to
    // be matched explicitly — SQL inequality never matches NULL, so a plain
    // `not: shouldTeamId` silently skips unstamped leads and under-reports.
    const wrongLeads = await prisma.lead.count({
      where: {
        assignedToId: a.id,
        ...(shouldTeamId === null
          ? { NOT: { teamId: null } }
          : { OR: [{ teamId: { not: shouldTeamId } }, { teamId: null }] }),
      },
    });

    if (!userDrift && wrongLeads === 0) continue;

    const from = a.teamId ? (teamById.get(a.teamId)?.name ?? a.teamId) : '(no team)';
    const to = shouldTeam?.name ?? '(no team)';
    console.log(`${a.employeeCode ?? a.id}  ${a.name}`);
    console.log(`   manager (kept)  : ${a.managedBy?.name ?? '(none)'}`);
    if (userDrift) console.log(`   team            : ${from}  ->  ${to}`);
    if (wrongLeads > 0) console.log(`   leads re-stamped: ${wrongLeads} of ${a._count.assignedLeads}  ->  ${to}`);

    if (APPLY) {
      await prisma.$transaction(async (tx) => {
        if (userDrift) {
          await tx.user.update({
            where: { id: a.id },
            data: { teamId: shouldTeamId, managerId: a.managedById ?? null },
          });
        }
        if (wrongLeads > 0) {
          await tx.lead.updateMany({
            where: { assignedToId: a.id },
            data: { teamId: shouldTeamId },
          });
        }
      });
    }
    if (userDrift) userFixes++;
    leadFixes += wrongLeads;
    console.log('');
  }

  // Assigned leads with no team stamp at all leak to every TL via the
  // "unassigned" branch of getLeadWhereClause, so report them separately.
  const orphanStamps = await prisma.lead.count({
    where: { assignedToId: { not: null }, teamId: null },
  });

  console.log('─'.repeat(60));
  console.log(`agents needing a team correction : ${userFixes}`);
  console.log(`leads needing a re-stamp         : ${leadFixes}`);
  console.log(`assigned leads still unstamped   : ${orphanStamps}`);
  if (!APPLY && (userFixes || leadFixes)) {
    console.log('');
    console.log('Re-run with --apply to write these changes.');
  }
})()
  .catch((e) => { console.error('ERR', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
