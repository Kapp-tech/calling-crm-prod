import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Auto-assigning incoming leads by Data Calling Type.
 *
 * A lead arriving with one of the configured Data Calling Types is handed
 * straight to an agent, round-robin, instead of waiting in the Assign Leads
 * queue for someone to distribute it. Off by default and controlled entirely
 * from Configurations → Priority Settings.
 *
 * It runs at ingestion, after the Data Calling Type has been resolved — which
 * for a lead code mapping means after LeadCode List has had its say, so the
 * rule matches the value the lead will actually carry rather than whatever the
 * payload asked for.
 */

export const PRIORITY_SETTING_ID = 'singleton';

export interface PriorityRule {
  isEnabled: boolean;
  dataCallingTypes: string[];
  agentIds: string[];
}

/** Empty and disabled when nothing has been configured yet. */
export async function loadPriorityRule(
  db: PrismaClient | Prisma.TransactionClient,
): Promise<PriorityRule> {
  const row = await db.priorityAssignmentSetting.findUnique({
    where: { id: PRIORITY_SETTING_ID },
    select: { isEnabled: true, dataCallingTypes: true, agentIds: true },
  });
  return row ?? { isEnabled: false, dataCallingTypes: [], agentIds: [] };
}

/**
 * Does this lead's Data Calling Type trigger the rule?
 *
 * Case-insensitive, because the value can arrive from a CSV, an API payload or
 * a lead-code mapping and the three do not agree on casing.
 */
export function matchesRule(rule: PriorityRule, dataCallingType: string | null | undefined): boolean {
  if (!rule.isEnabled || rule.dataCallingTypes.length === 0 || rule.agentIds.length === 0) return false;
  const v = (dataCallingType ?? '').trim().toLowerCase();
  if (!v) return false;
  return rule.dataCallingTypes.some((t) => t.trim().toLowerCase() === v);
}

/**
 * The agents a rule may actually assign to, in a stable order.
 *
 * Re-checked against live users every time rather than trusted from the stored
 * ids: an agent who has been deactivated or had their role changed must stop
 * receiving leads without anyone having to remember to edit the setting.
 * Ordered by id so the rotation is the same sequence on every server and does
 * not shuffle when somebody is renamed.
 */
export async function eligibleAgents(
  db: PrismaClient | Prisma.TransactionClient,
  rule: PriorityRule,
): Promise<{ id: string; name: string }[]> {
  if (rule.agentIds.length === 0) return [];
  return db.user.findMany({
    where: { id: { in: rule.agentIds }, role: 'COUNSELLING_AGENT', isActive: true },
    select: { id: true, name: true },
    orderBy: { id: 'asc' },
  });
}

/**
 * Reserves `count` consecutive round-robin slots and returns where they start.
 *
 * One atomic increment rather than a read-then-write: two uploads landing at
 * the same moment would otherwise both read the same cursor and hand the same
 * agent every lead. Incrementing by the whole batch also means a 1,000-lead
 * CSV costs one write, not a thousand.
 */
async function reserveSlots(
  db: PrismaClient | Prisma.TransactionClient,
  count: number,
): Promise<number> {
  const row = await db.priorityAssignmentSetting.update({
    where: { id: PRIORITY_SETTING_ID },
    data: {
      cursor: { increment: count },
      assignedCount: { increment: count },
      lastAssignedAt: new Date(),
    },
    select: { cursor: true },
  });
  // `cursor` comes back already incremented, so the batch starts before it.
  return row.cursor - count;
}

/**
 * Picks an agent for each lead that matches the rule.
 *
 * Takes the leads' calling types and returns a parallel array of agent ids,
 * `null` where the lead does not match or the rule is off. The caller applies
 * them — this deliberately does not write to Lead, so it can be used by a
 * `createMany` path that has no rows to update yet.
 */
export async function planPriorityAssignments(
  db: PrismaClient | Prisma.TransactionClient,
  dataCallingTypes: (string | null | undefined)[],
): Promise<(string | null)[]> {
  const none = dataCallingTypes.map(() => null);

  const rule = await loadPriorityRule(db);
  if (!rule.isEnabled) return none;

  const matching = dataCallingTypes.map((t) => matchesRule(rule, t));
  const howMany = matching.filter(Boolean).length;
  if (howMany === 0) return none;

  const agents = await eligibleAgents(db, rule);
  // Configured agents can all be gone — deactivated, or role changed. Leaving
  // the lead unassigned puts it in the Assign Leads queue, which is where an
  // unroutable lead belongs.
  if (agents.length === 0) return none;

  const start = await reserveSlots(db, howMany);

  let n = 0;
  return matching.map((isMatch) => (isMatch ? agents[(start + n++) % agents.length].id : null));
}

/** The assignment fields a freshly auto-assigned lead carries. */
export function assignmentFields(agentId: string, now = new Date()) {
  return {
    assignedToId: agentId,
    assignedAt: now,
    // No assignedById: nobody pressed a button. Leaving it null is what
    // distinguishes an automatic assignment from one a TL made by hand.
    assignedById: null,
  };
}
