import type { Prisma } from '@prisma/client';

/**
 * Returning leads to the unassigned pool.
 *
 * "Unassigned" means three things together, and all three have to happen or the
 * lead is only half-released:
 *
 *   1. `assignedToId` is cleared, so no agent holds it;
 *   2. `teamId` is cleared too — `getLeadWhereClause` treats a null team AND a
 *      null assignee as "free to pick up", so a lead that keeps its team stamp
 *      stays inside that team instead of returning to the open queue;
 *   3. pending scheduled calls are CANCELLED, because a callback booked by the
 *      previous owner would otherwise sit in a queue pointing at an agent who
 *      is no longer working the lead — and, after a deactivation, at one who is
 *      no longer here at all.
 *
 * Only APPROVED leads, which is the only status assignment ever applies to.
 *
 * Shared by the manual "unassign selected" action and by user deactivation so
 * the two cannot drift. They did not start out shared, and the scheduled-call
 * cancellation is exactly the sort of step a second copy would have omitted.
 */
export async function unassignLeads(
  tx: Prisma.TransactionClient,
  where: Prisma.LeadWhereInput,
): Promise<number> {
  // Resolved to ids first: the scheduled-call cancellation and the lead update
  // must act on the SAME set, and re-running the where clause after the leads
  // have been cleared would match nothing.
  //
  // AND rather than a spread. Spreading the caller's clause into the same
  // object lets these fixed conditions silently overwrite a key it already
  // used — `{ assignedToId: userId }` became `{ assignedToId: { not: null } }`,
  // widening "this agent's leads" to "every assigned lead in the database".
  // An AND cannot drop a caller's condition however the keys collide.
  const leads = await tx.lead.findMany({
    where: { AND: [where, { status: 'APPROVED', assignedToId: { not: null } }] },
    select: { id: true },
  });
  if (leads.length === 0) return 0;
  const ids = leads.map((l) => l.id);

  await tx.scheduledCall.updateMany({
    where: { leadId: { in: ids }, status: 'PENDING' },
    data: { status: 'CANCELLED' },
  });
  const result = await tx.lead.updateMany({
    where: { id: { in: ids } },
    data: { assignedToId: null, teamId: null },
  });
  return result.count;
}
