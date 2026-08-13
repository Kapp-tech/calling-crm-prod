import type { Prisma, Role } from '@prisma/client';
import { prisma } from './prisma';

interface SessionUser {
  id: string;
  role: Role;
  teamId?: string | null;
}

/**
 * Access controlled where-clause for leads.
 * Every API route that returns leads MUST call this and merge the result into its where clause.
 * Do NOT remove or bypass this — it enforces role-based data visibility at the DB level.
 */
export function getLeadWhereClause(user: SessionUser): Prisma.LeadWhereInput {
  switch (user.role) {
    case 'COUNSELLING_TL':
      // TL sees APPROVED leads that are either:
      //   (a) genuinely unassigned — available for them to assign
      //   (b) stamped with their team
      //   (c) held by an agent they manage, even if the stamp is stale
      // Pending/disapproved leads are never shown to TL.
      return {
        status: 'APPROVED',
        OR: [
          // `assignedToId` must be checked alongside the null team: a lead that
          // IS assigned but carries no team stamp would otherwise match here
          // and be exposed to every TL rather than just the assignee's own.
          { teamId: null, assignedToId: null },
          { team: { teamLeadId: user.id } },
          // Belt-and-braces against team/manager drift (see lib/team-sync.ts):
          // a TL should always see what their own agents are working, even if
          // an agent has no team yet or a lead's stamp hasn't caught up. This
          // can only ever add leads the TL already owns via their agents — it
          // never widens access to another team's work.
          { assignedTo: { managedById: user.id } },
        ],
      };

    case 'COUNSELLING_AGENT':
      // Agent sees ONLY approved leads assigned to themselves
      return {
        status: 'APPROVED',
        assignedToId: user.id,
      };

    case 'REPORTS':
      // Reports sees ALL statuses (that's the whole point of their role)
      return {};

    case 'OPERATIONS':
      // Operations sees only leads they uploaded (all statuses)
      return { uploadedById: user.id };

    case 'SUPER_ADMIN':
      // SA sees everything, no restriction
      return {};

    default:
      // Fallback: return nothing — unknown roles get zero leads
      return { id: 'never-match' };
  }
}

/**
 * Returns true only if this user is allowed to see the given lead, using the
 * same visibility rules as getLeadWhereClause. Every /api/leads/[id]/* route
 * MUST call this (or merge getLeadWhereClause into its query) before reading
 * or writing anything belonging to the lead.
 */
export async function canAccessLead(user: SessionUser, leadId: string): Promise<boolean> {
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, getLeadWhereClause(user)] },
    select: { id: true },
  });
  return lead !== null;
}

/** Validate a lead row before approval — returns null if valid, error string if invalid */
export function validateLeadForApproval(lead: {
  name: string;
  email: string;
  phone: string;
  course?: string | null;
}): string | null {
  if (!lead.name?.trim()) return 'Name is empty';
  if (!lead.email?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email)) return 'Invalid email';
  if (!lead.phone?.trim() || !/^\d{10}$/.test(lead.phone.replace(/\D/g, ''))) return 'Phone must be 10 digits';
  if (!lead.course?.trim()) return 'Course is empty';
  return null;
}
