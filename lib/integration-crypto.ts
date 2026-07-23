import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { SECRET_UNCHANGED_SENTINEL } from '@/lib/lead-integration-constants';

export { SECRET_UNCHANGED_SENTINEL };

// Encrypts secret values (e.g. a third-party API key an admin pastes into a
// Lead Integration's header config) before they hit Postgres. Unlike
// lib/api-key.ts's one-way hash (we never need the raw value back), a
// header value must be recovered in full to send in the outbound request,
// so this is reversible AES-256-GCM rather than a hash.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended nonce size for GCM

function getKey(): Buffer {
  const hex = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!hex) throw new Error('INTEGRATION_ENCRYPTION_KEY is not configured');
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) throw new Error('INTEGRATION_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return key;
}

/** Returns "iv:authTag:ciphertext", all hex-encoded. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(payload: string): string {
  const [ivHex, authTagHex, dataHex] = payload.split(':');
  if (!ivHex || !authTagHex || !dataHex) throw new Error('Malformed encrypted payload');
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

/** Masked display value for the edit UI — never send the real secret back to the browser. */
export function maskSecret(): string {
  return '••••••••••••';
}
