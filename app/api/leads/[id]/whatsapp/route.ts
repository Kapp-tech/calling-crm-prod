import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';
import { buildWhatsAppUrl, leadWhatsAppMessage } from '@/lib/whatsapp';

/**
 * Opens WhatsApp for one lead without putting its number in the page.
 *
 * Masking works by never sending the real phone to the browser, so a masked
 * agent's copy of the lead reads "98****4460" and there is no chat to open.
 * The button used to hide itself for that reason. But the point of masking is
 * that the number cannot be *collected* — read off a list, copied, taken
 * elsewhere — not that the agent may never message the lead they were assigned
 * to work. Those are different things, and the second one was being blocked to
 * get the first.
 *
 * This route separates them. The browser asks for a lead by id and is
 * redirected to wa.me; the number is resolved here, from the id, and is never
 * part of an API payload. A masked agent can message one lead at a time, the
 * one already in front of them, and still cannot page a list of numbers out of
 * the CRM — which is what masking was protecting.
 *
 * Handing the number to WhatsApp does mean it appears in the tab that opens.
 * That is inherent to opening a chat at all: wa.me addresses a conversation by
 * number, so there is no version of this feature where the number stays hidden
 * from the person sending the message. The protection kept here is the one that
 * was actually doing work — no bulk access — and the exposure is one lead, on a
 * deliberate click, from a page that already shows who the lead is.
 *
 * `canAccessLead` is the same gate the rest of the lead routes use, so this
 * widens nothing: an agent who cannot open a lead cannot resolve its number.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!(await canAccessLead(session.user, params.id))) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { name: true, phone: true, course: true },
  });
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const url = buildWhatsAppUrl(
    lead.phone,
    leadWhatsAppMessage({
      leadName: lead.name,
      agentName: session.user.name ?? undefined,
      course: lead.course,
    }),
  );
  // Same undialable-number case the button handles by hiding itself. Reached
  // only if the stored number is malformed, so say that rather than bouncing
  // the user to a dead WhatsApp tab.
  if (!url) {
    return NextResponse.json({ error: 'This lead has no dialable WhatsApp number.' }, { status: 422 });
  }

  // 302, not 307: this is a one-off lookup whose answer can change when the
  // lead's number is edited, and nothing downstream should cache it.
  return NextResponse.redirect(url, 302);
}
