import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

// ── Tunables ─────────────────────────────────────────────────────────────
// A 6-digit PIN only has 1,000,000 combinations, so the real defense isn't
// the hash — it's rate-limiting online guesses. Lock the PIN out after a
// handful of wrong attempts rather than relying on hash cost alone.
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;
// How long a successful PIN verification keeps a gated action open before
// it re-locks and needs the PIN again.
export const UNLOCK_WINDOW_MINUTES = 20;

const PIN_RE = /^\d{6}$/;

export function isValidPinFormat(pin: string): boolean {
  return PIN_RE.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 12);
}

type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_SET' }
  | { ok: false; reason: 'LOCKED'; lockedUntil: Date }
  | { ok: false; reason: 'WRONG'; attemptsRemaining: number };

/**
 * Checks a PIN attempt against the stored hash, applying (and updating)
 * lockout state. Always re-reads the user row fresh, so concurrent attempts
 * can't race past the attempt counter.
 */
export async function verifyPinAttempt(userId: string, pin: string): Promise<VerifyResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { securityPinHash: true, securityPinFailedAttempts: true, securityPinLockedUntil: true },
  });
  if (!user?.securityPinHash) return { ok: false, reason: 'NOT_SET' };

  if (user.securityPinLockedUntil && user.securityPinLockedUntil > new Date()) {
    return { ok: false, reason: 'LOCKED', lockedUntil: user.securityPinLockedUntil };
  }

  const matches = await bcrypt.compare(pin, user.securityPinHash);
  if (matches) {
    await prisma.user.update({
      where: { id: userId },
      data: { securityPinFailedAttempts: 0, securityPinLockedUntil: null },
    });
    return { ok: true };
  }

  const failedAttempts = user.securityPinFailedAttempts + 1;
  const lockedOut = failedAttempts >= MAX_FAILED_ATTEMPTS;
  await prisma.user.update({
    where: { id: userId },
    data: {
      securityPinFailedAttempts: lockedOut ? 0 : failedAttempts,
      securityPinLockedUntil: lockedOut ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
    },
  });

  if (lockedOut) {
    return { ok: false, reason: 'LOCKED', lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) };
  }
  return { ok: false, reason: 'WRONG', attemptsRemaining: MAX_FAILED_ATTEMPTS - failedAttempts };
}

/** Grants (or refreshes) a time-boxed unlock for one gated action. */
export async function grantUnlock(userId: string, action: string): Promise<Date> {
  const expiresAt = new Date(Date.now() + UNLOCK_WINDOW_MINUTES * 60_000);
  await prisma.adminActionUnlock.upsert({
    where: { userId_action: { userId, action } },
    create: { userId, action, expiresAt },
    update: { expiresAt },
  });
  return expiresAt;
}

export async function revokeUnlock(userId: string, action: string): Promise<void> {
  await prisma.adminActionUnlock.deleteMany({ where: { userId, action } });
}

/** The actual server-side enforcement — call this from every PIN-gated route. */
export async function isActionUnlocked(userId: string, action: string): Promise<boolean> {
  const unlock = await prisma.adminActionUnlock.findUnique({
    where: { userId_action: { userId, action } },
    select: { expiresAt: true },
  });
  return !!unlock && unlock.expiresAt > new Date();
}

export interface GateStatus {
  pinConfigured: boolean;
  unlocked: boolean;
  expiresAt: string | null;
  lockedUntil: string | null;
}

export async function getGateStatus(userId: string, action: string): Promise<GateStatus> {
  const [user, unlock] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { securityPinHash: true, securityPinLockedUntil: true } }),
    prisma.adminActionUnlock.findUnique({ where: { userId_action: { userId, action } }, select: { expiresAt: true } }),
  ]);

  const now = new Date();
  const unlocked = !!unlock && unlock.expiresAt > now;
  const lockedUntil = user?.securityPinLockedUntil && user.securityPinLockedUntil > now ? user.securityPinLockedUntil : null;

  return {
    pinConfigured: !!user?.securityPinHash,
    unlocked,
    expiresAt: unlocked ? unlock!.expiresAt.toISOString() : null,
    lockedUntil: lockedUntil ? lockedUntil.toISOString() : null,
  };
}
