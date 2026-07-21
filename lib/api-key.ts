import { randomBytes, createHash } from 'crypto';
import { prisma } from './prisma';

const KEY_PREFIX = 'kapp_live_';

/**
 * Generates a new API key. Returns the raw key (show to the admin exactly
 * once — it is never recoverable after this) plus the values to persist.
 * Hashing uses plain SHA-256: the key itself is the secret (256 bits of
 * random entropy), not a low-entropy human password, so there's nothing for
 * a slow KDF like bcrypt to protect against here — a hash lookup by index
 * is the same approach GitHub/Stripe use for their API tokens.
 */
export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `${KEY_PREFIX}${randomBytes(32).toString('hex')}`;
  return {
    rawKey,
    keyHash: hashApiKey(rawKey),
    keyPrefix: rawKey.slice(0, 18), // "kapp_live_" + 8 hex chars — enough to tell keys apart in a list
  };
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export interface AuthenticatedApiKey {
  id: string;
  name: string;
  createdById: string;
}

/**
 * Verifies the raw key from an incoming request's Authorization header.
 * Returns the key record (and bumps lastUsedAt) if valid and active, or
 * null if missing, malformed, unknown, or revoked — callers should treat
 * all of those as 401.
 */
export async function verifyApiKey(authHeader: string | null): Promise<AuthenticatedApiKey | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const rawKey = authHeader.slice('Bearer '.length).trim();
  if (!rawKey) return null;

  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(rawKey) },
    select: { id: true, name: true, createdById: true, isActive: true },
  });
  if (!record || !record.isActive) return null;

  // Best-effort audit trail — never let a logging hiccup block the request.
  prisma.apiKey
    .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    .catch((err) => console.error('[verifyApiKey] failed to bump lastUsedAt:', err));

  return { id: record.id, name: record.name, createdById: record.createdById };
}
