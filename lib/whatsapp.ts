/**
 * Building a wa.me link for a lead.
 *
 * Kept out of the button component because the server needs these too: the
 * masked path resolves the number in app/api/leads/[id]/whatsapp and builds the
 * same link there. A `'use client'` module is the wrong place for anything the
 * server calls — its exports can come back as client references — so the two
 * pure helpers live here and the component imports them.
 */

/**
 * Normalises an Indian mobile number to a wa.me target.
 * Returns null when the number can't be normalised to a dialable form, so
 * callers can hide the button instead of sending users to a dead link.
 */
export function buildWhatsAppUrl(phone: string, message: string): string | null {
  const digits = phone.replace(/\D/g, '');
  let full: string | null = null;
  if (digits.length === 10) full = `91${digits}`;
  else if (digits.length === 12 && digits.startsWith('91')) full = digits;
  else if (digits.length === 11 && digits.startsWith('0')) full = `91${digits.slice(1)}`;
  if (!full) return null;
  return `https://wa.me/${full}?text=${encodeURIComponent(message)}`;
}

/** Pre-filled first-touch template for a lead. */
export function leadWhatsAppMessage(opts: {
  leadName: string;
  agentName?: string;
  course?: string | null;
}): string {
  const intro = opts.agentName
    ? `Hi ${opts.leadName}, this is ${opts.agentName} from KollegeApply.`
    : `Hi ${opts.leadName}, greetings from KollegeApply!`;
  const context = opts.course
    ? ` I'm reaching out regarding your interest in ${opts.course}.`
    : ` I'm reaching out regarding your admission enquiry.`;
  return `${intro}${context} Is this a good time to connect?`;
}
