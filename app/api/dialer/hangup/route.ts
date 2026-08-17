import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { externalHangup, isDialshreeConfigured, DialshreeError } from '@/lib/dialshree';

// Drops the caller's own live call. There is deliberately no way to pass
// someone else's agent id: the seat is always resolved from the session, so an
// agent can only hang up their own line.
const hangupSchema = z.object({
  leadId: z.string().min(1).optional(),
  // Echoed back from the dial response when the dialer returned a handle.
  // See the note on externalHangup for why this is pass-through.
  value: z.string().min(1).max(64).optional(),
});

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  if (!isDialshreeConfigured()) {
    return NextResponse.json(
      { success: false, error: 'Calling is not configured on this server.' },
      { status: 503 }
    );
  }

  try {
    const parsed = hangupSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    }

    const me = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { dialshreeId: true },
    });
    if (!me?.dialshreeId) {
      return NextResponse.json(
        { success: false, code: 'NO_DIALER_ID', error: 'Your account is not linked to a dialer extension.' },
        { status: 409 }
      );
    }

    const result = await externalHangup({ agentUser: me.dialshreeId, value: parsed.data.value });

    await logActivity({
      userId: session.user.id,
      action: 'CALL_HANGUP',
      targetId: parsed.data.leadId,
      targetType: 'Lead',
      description: 'Ended call',
      metadata: { dialshreeId: me.dialshreeId },
    });

    return NextResponse.json({ success: true, result });
  } catch (err) {
    if (err instanceof DialshreeError) {
      console.error('[dialer/hangup]', err.message, err.detail);
      return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    }
    console.error('[dialer/hangup]', err);
    return NextResponse.json({ success: false, error: 'Could not end the call' }, { status: 500 });
  }
}
