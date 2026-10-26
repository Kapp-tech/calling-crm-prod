import { Prisma, Role, Feature } from '@prisma/client';
import { hasPermission } from '@/lib/permissions';

export type CallAnalysisView = 'agent' | 'manager';

export interface CallAnalysisScope {
  view: CallAnalysisView;
  /**
   * The widest set this session may ever see, ANDed onto every query and
   * every summary figure. `{}` means unrestricted.
   */
  where: Prisma.CallAnalysisWhereInput;
}

/**
 * Who may read call analysis, and whose calls they get.
 *
 * Derived from the session, never from a request parameter — the same rule
 * the agent-performance report follows. Request filters (`agentId`, `leadId`,
 * a search) are ANDed on top, so they can only ever *narrow* what the session
 * already permits. An agent cannot widen their view by editing the URL.
 *
 * `VIEW_REPORTS` is not required of an agent, and deliberately so: that
 * permission means "may read org-wide reports", which is exactly what an
 * agent is not getting here. They see their own calls and nothing else, so
 * gating them on it would make the page unreachable for the one role whose
 * access is already the narrowest possible. Every other role does need it, so
 * revoking it in Manage Permissions still works as the screen implies.
 *
 * Returns null when the session may not read this at all.
 */
export async function resolveCallAnalysisScope(
  user: { id: string; role: Role },
): Promise<CallAnalysisScope | null> {
  if (user.role === Role.COUNSELLING_AGENT) {
    // Their own calls: the dialer's attribution, which is what the Call
    // Analysis list, the KPI and the reports all count an agent's calls by.
    return { view: 'agent', where: { callLog: { agentId: user.id } } };
  }

  if (!(await hasPermission(user.role, Feature.VIEW_REPORTS))) return null;

  // SUPER_ADMIN, REPORTS and COUNSELLING_TL see every scored call.
  //
  // A TL is NOT pinned to their own team here, unlike the agent-performance
  // report. That is the current behaviour and nobody has asked to change it;
  // narrowing it is one line — give the TL branch
  // `{ callLog: { agent: { OR: [{ managedById: user.id }, { team: { teamLeadId: user.id } }] } } }`.
  return { view: 'manager', where: {} };
}
