/**
 * Masking a lead's email and phone.
 *
 * The `MASK_UNMASK_DATA` permission means **"this role sees masked data"**. The
 * enum value keeps its old name because renaming it costs an `ALTER TYPE` plus
 * a data migration for no behavioural gain; the Manage Permissions screen calls
 * it "Mask Data", which is what it does.
 *
 * This module is imported by client components too, so it must stay free of
 * Prisma — the rule for *who* is masked lives in lib/permissions.ts
 * (`isMaskedRole`), which is server-only.
 *
 * Masking happens on the SERVER, in the API response. It used to be done in the
 * browser on the Lead Approvals page, which hid nothing: the real address and
 * number were still in the JSON, one devtools tab away. If the point is that a
 * role cannot see a lead's contact details, the details must never reach them.
 */

/** j***@gmail.com — the domain is kept so a lead is still recognisable. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(0, local.length - 2))}@${domain}`;
}

/** 98****4460 — first and last two, enough to tell two leads apart. */
export function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return `${phone.slice(0, 2)}${'*'.repeat(phone.length - 4)}${phone.slice(-2)}`;
}

/** Applies masking to whatever subset of the two fields an object carries. */
export function maskContact<T extends { email?: string | null; phone?: string | null }>(
  row: T,
  masked: boolean,
): T {
  if (!masked) return row;
  return {
    ...row,
    ...(row.email ? { email: maskEmail(row.email) } : {}),
    ...(row.phone ? { phone: maskPhone(row.phone) } : {}),
  };
}
