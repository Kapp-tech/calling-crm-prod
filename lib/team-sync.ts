import type { Prisma } from '@prisma/client';

// A Counselling Agent's Team Lead is expressed in FOUR places that all have to
// agree, or the CRM contradicts itself:
//
//   User.managedById  — the "Manager" column in User Management
//   User.managerId    — the reporting line used by the hierarchy helpers
//   User.teamId       — team membership, what Org Hierarchy and the team pages group by
//   Lead.teamId       — stamped on each lead; what getLeadWhereClause lets a TL see
//
// Historically only the first was updated when an admin changed an agent's
// manager, so the agent appeared under the new TL in User Management while Org
// Hierarchy, the team pages, and — most damagingly — lead visibility all still
// pointed at the old TL. The new TL could see the agent but none of their leads;
// the old TL kept seeing leads for an agent who had left their team.
//
// prisma/schema.prisma marks managedById as the legacy relation, so team
// membership is the source of truth here: managedById/managerId are kept in
// step with it rather than the other way round.
//
// Everything below takes a transaction client — moving an agent must be
// all-or-nothing, otherwise a failure halfway through leaves exactly the split
// state this module exists to prevent.

/** The team a Team Lead owns, or null if they don't lead one yet. */
export async function findTeamLedBy(
  tx: Prisma.TransactionClient,
  tlId: string,
): Promise<string | null> {
  const team = await tx.team.findFirst({
    where: { teamLeadId: tlId },
    select: { id: true },
  });
  return team?.id ?? null;
}

export interface AgentMoveResult {
  /** The team the agent now belongs to. */
  teamId: string | null;
  /** How many of the agent's leads were re-stamped onto that team. */
  leadsMoved: number;
  /** True when nothing actually changed (already consistent). */
  alreadyInSync: boolean;
}

/**
 * Puts an agent under `newTlId` and brings all four fields into agreement,
 * including re-stamping the leads already assigned to that agent so they follow
 * the agent to the new Team Lead.
 *
 * Pass `null` to detach the agent from any Team Lead — their leads are
 * un-stamped too, which correctly returns them to the "assignable" pool rather
 * than leaving them owned by a team the agent is no longer in.
 */
export async function moveAgentToTeamLead(
  tx: Prisma.TransactionClient,
  agentId: string,
  newTlId: string | null,
): Promise<AgentMoveResult> {
  const agent = await tx.user.findUnique({
    where: { id: agentId },
    select: { teamId: true, managedById: true },
  });

  const newTeamId = newTlId ? await findTeamLedBy(tx, newTlId) : null;

  if (agent && agent.managedById === newTlId && agent.teamId === newTeamId) {
    return { teamId: newTeamId, leadsMoved: 0, alreadyInSync: true };
  }

  await tx.user.update({
    where: { id: agentId },
    data: { managedById: newTlId, managerId: newTlId, teamId: newTeamId },
  });

  // Leads follow the agent. Scoped to leads still assigned to them, so leads
  // they handed off earlier stay with whoever holds them now.
  const { count } = await tx.lead.updateMany({
    where: { assignedToId: agentId },
    data: { teamId: newTeamId },
  });

  return { teamId: newTeamId, leadsMoved: count, alreadyInSync: false };
}

/**
 * Same reconciliation, driven by the destination team instead of the TL —
 * for callers that know the team (team admin screens, CSV import) rather than
 * the manager. The team's own lead becomes the agent's manager.
 */
export async function moveAgentToTeam(
  tx: Prisma.TransactionClient,
  agentId: string,
  newTeamId: string | null,
): Promise<AgentMoveResult> {
  if (!newTeamId) return moveAgentToTeamLead(tx, agentId, null);

  const team = await tx.team.findUnique({
    where: { id: newTeamId },
    select: { teamLeadId: true },
  });

  const agent = await tx.user.findUnique({
    where: { id: agentId },
    select: { teamId: true, managedById: true },
  });

  if (agent && agent.teamId === newTeamId && agent.managedById === (team?.teamLeadId ?? null)) {
    return { teamId: newTeamId, leadsMoved: 0, alreadyInSync: true };
  }

  await tx.user.update({
    where: { id: agentId },
    data: {
      teamId: newTeamId,
      managedById: team?.teamLeadId ?? null,
      managerId: team?.teamLeadId ?? null,
    },
  });

  const { count } = await tx.lead.updateMany({
    where: { assignedToId: agentId },
    data: { teamId: newTeamId },
  });

  return { teamId: newTeamId, leadsMoved: count, alreadyInSync: false };
}

/**
 * Re-points every member of a team at that team's (possibly new) Team Lead.
 * Used when a team's lead is swapped out, so the members' Manager column
 * doesn't keep naming the previous lead.
 */
export async function syncTeamMembersToLead(
  tx: Prisma.TransactionClient,
  teamId: string,
  teamLeadId: string | null,
): Promise<number> {
  const { count } = await tx.user.updateMany({
    where: { teamId, role: 'COUNSELLING_AGENT' },
    data: { managedById: teamLeadId, managerId: teamLeadId },
  });
  return count;
}
