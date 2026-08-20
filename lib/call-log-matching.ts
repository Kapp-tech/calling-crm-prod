import { Prisma } from '@prisma/client';

/**
 * Which CallLog rows belong to a lead.
 *
 * Two ways a row qualifies:
 *
 * 1. The webhook matched it at write time (`leadId` is set).
 * 2. It never matched anything, but its number is this lead's number.
 *
 * The second case is not a nicety. The webhook can only match against leads that
 * exist *when the call lands*, so a call placed before the lead was created — or
 * whose match failed because the number was corrected afterwards — would
 * otherwise stay invisible for good, while sitting in the table the whole time.
 * Matching on the number at read time makes the history appear as soon as the
 * lead does, with no backfill required.
 *
 * Only rows with no lead at all are pulled in this way, so a call already
 * attributed to a different lead is never shown against this one.
 *
 * The dialer sometimes includes the country code, so the comparison is on the
 * trailing digits rather than equality.
 */
export function callsForLead(leadId: string, leadPhone: string | null): Prisma.CallLogWhereInput {
  const phone = (leadPhone ?? '').replace(/\D+/g, '');
  if (phone.length < 10) return { leadId };

  return {
    OR: [{ leadId }, { AND: [{ leadId: null }, { phoneNumber: { endsWith: phone.slice(-10) } }] }],
  };
}
