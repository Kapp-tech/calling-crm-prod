import { prisma } from './prisma';
import { Feature, Role } from '@prisma/client';
import type { User, Lead } from '@prisma/client';

// ─── Permission DB helpers ────────────────────────────────────────────────────

// Hardcoded defaults — used as fallback when no DB entry exists
const DEFAULT_PERMISSIONS: Record<Role, Feature[]> = {
  SUPER_ADMIN: Object.values(Feature),
  REPORTS: [Feature.VIEW_REPORTS, Feature.DOWNLOAD_DATA, Feature.MASK_UNMASK_DATA, Feature.APPROVE_LEADS],
  OPERATIONS: [Feature.UPLOAD_LEADS],
  COUNSELLING_TL: [Feature.VIEW_LEADS, Feature.ASSIGN_LEADS],
  COUNSELLING_AGENT: [Feature.VIEW_LEADS, Feature.SUBMIT_FEEDBACK],
};

export async function hasPermission(role: Role, feature: Feature): Promise<boolean> {
  if (role === Role.SUPER_ADMIN) return true;
  const p = await prisma.permission.findUnique({ where: { role_feature: { role, feature } } });
  // If no DB row, fall back to hardcoded defaults so the system works out of the box
  if (p === null) return DEFAULT_PERMISSIONS[role]?.includes(feature) ?? false;
  return p.canAccess;
}

export async function getRolePermissions(role: Role): Promise<Record<Feature, boolean>> {
  if (role === Role.SUPER_ADMIN) {
    return Object.values(Feature).reduce((acc, f) => ({ ...acc, [f]: true }), {} as Record<Feature, boolean>);
  }
  const perms = await prisma.permission.findMany({ where: { role } });
  return Object.values(Feature).reduce(
    (acc, f) => ({
      ...acc,
      // DB row takes precedence; fall back to hardcoded defaults (not false) when no row exists yet
      [f]: perms.find((p) => p.feature === f)?.canAccess ?? DEFAULT_PERMISSIONS[role]?.includes(f) ?? false,
    }),
    {} as Record<Feature, boolean>
  );
}

export async function getAllPermissions(): Promise<Record<Role, Record<Feature, boolean>>> {
  const perms = await prisma.permission.findMany();
  const result = {} as Record<Role, Record<Feature, boolean>>;
  for (const role of Object.values(Role)) {
    result[role] = Object.values(Feature).reduce(
      (acc, f) => ({
        ...acc,
        [f]: role === Role.SUPER_ADMIN
          ? true
          : (perms.find((p) => p.role === role && p.feature === f)?.canAccess
             ?? DEFAULT_PERMISSIONS[role]?.includes(f)
             ?? false),
      }),
      {} as Record<Feature, boolean>
    );
  }
  return result;
}

// ─── Hierarchy utilities ──────────────────────────────────────────────────────

/**
 * Returns true if actor can view/manage the target user based on role hierarchy.
 * SA can access anyone. TL can access their own agents. Others: only themselves.
 */
export function canAccessUser(actor: User, target: User): boolean {
  if (actor.role === Role.SUPER_ADMIN) return true;
  if (actor.id === target.id) return true;
  if (actor.role === Role.COUNSELLING_TL && target.managedById === actor.id) return true;
  return false;
}

/**
 * Returns true if actor can assign the lead to someone.
 * SA can assign any lead. TL can assign leads that belong to their team.
 */
export function canAssignLead(actor: User, lead: Lead): boolean {
  if (actor.role === Role.SUPER_ADMIN) return true;
  if (actor.role !== Role.COUNSELLING_TL) return false;
  if (lead.status !== 'APPROVED') return false;
  // TL can assign approved leads — team check done at API level with teamId
  return true;
}

/**
 * Returns true if actor is in the management chain above target.
 * SA > TL > Agent hierarchy.
 */
export async function isInHierarchy(actor: User, target: User): Promise<boolean> {
  if (actor.role === Role.SUPER_ADMIN) return true;
  if (actor.id === target.managerId) return true;
  if (actor.id === target.managedById) return true;
  // Walk up one more level: actor manages target's manager
  if (target.managerId) {
    const targetManager = await prisma.user.findUnique({ where: { id: target.managerId } });
    if (targetManager && targetManager.managerId === actor.id) return true;
  }
  return false;
}

// ─── Employee Code generator ──────────────────────────────────────────────────

export async function generateEmployeeCode(): Promise<string> {
  const last = await prisma.user.findFirst({
    where: { employeeCode: { startsWith: 'EMP-' } },
    orderBy: { employeeCode: 'desc' },
    select: { employeeCode: true },
  });
  const next = last
    ? parseInt(last.employeeCode.replace('EMP-', ''), 10) + 1
    : 1;
  return `EMP-${String(next).padStart(3, '0')}`;
}

// ─── Activity Log helper ──────────────────────────────────────────────────────

import type { ActivityAction, Prisma } from '@prisma/client';

export async function logActivity(params: {
  userId: string;
  action: ActivityAction;
  targetId?: string;
  targetType?: string;
  description: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  await prisma.activityLog.create({ data: params });
}
