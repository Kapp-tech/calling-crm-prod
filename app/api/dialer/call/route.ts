import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { needsCheckIn } from '@/lib/attendance-gate';
import { ATTENDANCE_REQUIRED_CODE, ATTENDANCE_REQUIRED_MESSAGE } from '@/lib/attendance-required';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { canAccessLead } from '@/lib/lead-access';
import { manualDial, isDialshreeConfigured, DialshreeError } from '@/lib/dialshree';

// Click-to-call. The browser never sees the dialer's credentials or token —
// it posts a leadId here, and the server decides which number may be dialled
// and which dialer seat to ring.
const callSchema = z.object({
  leadId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  // Same gate as logging a follow-up: no attendance, no calling.
  if (await needsCheckIn(prisma, session.user)) {
    return NextResponse.json(
      { success: false, error: ATTENDANCE_REQUIRED_MESSAGE, code: ATTENDANCE_REQUIRED_CODE },
      { status: 403 },
    );
  }

  if (!isDialshreeConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Calling is not configured on this server. Ask an admin to set up the dialer.' },
      { status: 503 }
    );
  }

  try {
    const parsed = callSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'A leadId is required' }, { status: 400 });
    }

    // The caller supplies only an id — never a raw phone number — so this
    // endpoint cannot be used to dial arbitrary numbers on the company's
    // trunk. The number comes from a lead the user is allowed to open.
    const allowed = await canAccessLead(session.user, parsed.data.leadId);
    if (!allowed) {
      return NextResponse.json({ success: false, error: 'Lead not found' }, { status: 404 });
    }

    const [lead, me] = await Promise.all([
      prisma.lead.findUnique({
        where: { id: parsed.data.leadId },
        select: { id: true, name: true, phone: true },
      }),
      prisma.user.findUnique({
        where: { id: session.user.id },
        select: { dialshreeId: true },
      }),
    ]);

    if (!lead?.phone) {
      return NextResponse.json({ success: false, error: 'This lead has no phone number' }, { status: 400 });
    }
    if (!me?.dialshreeId) {
      return NextResponse.json(
        {
          success: false,
          code: 'NO_DIALER_ID',
          error:
            'Your account is not linked to a dialer extension yet. Ask an admin to add your DialShree ID in User Management.',
        },
        { status: 409 }
      );
    }

    // The dialer wants the subscriber number on its own, with the country code
    // in a separate field. Stored numbers are 10-digit, but strip any spacing
    // or +91 that crept in through an import before handing it over.
    const digits = lead.phone.replace(/\D/g, '');
    const subscriber = digits.length > 10 ? digits.slice(-10) : digits;
    if (subscriber.length !== 10) {
      return NextResponse.json(
        { success: false, error: `This lead's phone number (${lead.phone}) is not a valid 10-digit number.` },
        { status: 400 }
      );
    }

    const result = await manualDial({ phone: subscriber, agentUser: me.dialshreeId });

    await logActivity({
      userId: session.user.id,
      action: 'CALL_INITIATED',
      targetId: lead.id,
      targetType: 'Lead',
      description: `Called ${lead.name}`,
      // The dialer's own response is kept verbatim: it is the only record of
      // any call/channel handle it may return, which the hangup call needs.
      metadata: { dialshreeId: me.dialshreeId, response: result as never },
    });

    return NextResponse.json({ success: true, result });
  } catch (err) {
    if (err instanceof DialshreeError) {
      console.error('[dialer/call]', err.message, err.detail);
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error('[dialer/call]', err);
    return NextResponse.json({ success: false, error: 'Could not place the call' }, { status: 500 });
  }
}
