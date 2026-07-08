import { randomUUID } from 'crypto';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import path from 'path';

// Files live outside /public so they're never served by the static file
// server — only the authenticated route in app/api/leads/[id]/receipts/
// [receiptId]/file/route.ts can read them back.
const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'receipts');

export const ALLOWED_RECEIPT_FILE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/pdf': 'pdf',
};

export const MAX_RECEIPT_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export function isAllowedReceiptFile(mimeType: string): boolean {
  return mimeType in ALLOWED_RECEIPT_FILE_TYPES;
}

// Sanitized, collision-free on-disk name — the original filename is never
// used to build a path, so there's no path-traversal or overwrite risk.
export async function saveReceiptFile(leadId: string, mimeType: string, bytes: Buffer): Promise<string> {
  const ext = ALLOWED_RECEIPT_FILE_TYPES[mimeType];
  const dir = path.join(STORAGE_ROOT, leadId);
  await mkdir(dir, { recursive: true });
  const fileName = `${randomUUID()}.${ext}`;
  await writeFile(path.join(dir, fileName), bytes);
  return path.join(leadId, fileName);
}

export async function readReceiptFile(relativePath: string): Promise<Buffer> {
  const resolved = path.resolve(STORAGE_ROOT, relativePath);
  if (!resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error('Invalid file path');
  }
  return readFile(resolved);
}

export async function deleteReceiptFile(relativePath: string): Promise<void> {
  const resolved = path.resolve(STORAGE_ROOT, relativePath);
  if (!resolved.startsWith(STORAGE_ROOT + path.sep)) {
    throw new Error('Invalid file path');
  }
  await unlink(resolved).catch(() => {});
}

// Strip path separators / control characters from a user-supplied original
// filename before storing it purely for display purposes (never for the
// actual on-disk path).
export function sanitizeDisplayFileName(name: string): string {
  return name.replace(/[\\/]/g, '_').replace(/[\x00-\x1f]/g, '').slice(0, 200) || 'receipt';
}

// Display filename follows "<Number>+<CampusName>+<PaidDate>.<ext>" — the
// original uploaded filename is discarded in favour of this convention.
export function buildReceiptDisplayFileName(
  receiptNumber: string,
  campusName: string,
  paidDate: string,
  mimeType: string
): string {
  const ext = ALLOWED_RECEIPT_FILE_TYPES[mimeType] ?? 'dat';
  const base = `${receiptNumber}+${campusName}+${paidDate}`;
  return `${sanitizeDisplayFileName(base)}.${ext}`;
}
