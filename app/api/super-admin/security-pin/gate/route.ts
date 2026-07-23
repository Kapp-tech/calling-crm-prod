import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { logActivity } from '@/lib/permissions';
import { getGateStatus, grantUnlock, revokeUnlock, verifyPinAttempt, isValidPinFormat } from '@/lib/security-pin';

// Generic PIN-gate enforcement for individual Super Admin actions (e.g.
// "BULK_DELETE_LEADS"). Adding a new gated function elsewhere in the app
// means wrapping it in <PinGate action="SOME_NEW_KEY"> on the frontend and
// calling isActionUnlocked(userId, "SOME_NEW_KEY") in that action's API
// route — nothing here needs to change.

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const action = new URL(req.url).searchParams.get('action')?.trim();
  if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 });

  const status = await getGateStatus(session.user.id, action);
  return NextResponse.json(status);
}

const unlockSchema = z.object({
  action: z.string().min(1),
  pin: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const parsed = unlockSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    const { action, pin } = parsed.data;

    if (!isValidPinFormat(pin)) {
      return NextResponse.json({ success: false, error: 'PIN must be exactly 6 digits', code: 'INVALID_FORMAT' }, { status: 400 });
    }

    const result = await verifyPinAttempt(session.user.id, pin);
    if (!result.ok) {
      if (result.reason === 'NOT_SET') {
        return NextResponse.json({ success: false, error: 'You haven’t set up a security PIN yet', code: 'NOT_SET' }, { status: 400 });
      }
      if (result.reason === 'LOCKED') {
        return NextResponse.json(
          { success: false, error: 'Too many incorrect attempts — PIN entry is temporarily locked', code: 'LOCKED', lockedUntil: result.lockedUntil.toISOString() },
          { status: 423 },
        );
      }
      return NextResponse.json(
        { success: false, error: 'Incorrect PIN', code: 'WRONG', attemptsRemaining: result.attemptsRemaining },
        { status: 400 },
      );
    }

    const expiresAt = await grantUnlock(session.user.id, action);

    await logActivity({
      userId: session.user.id,
      action: 'SECURITY_ACTION_UNLOCKED',
      targetId: session.user.id,
      targetType: 'User',
      description: `Unlocked "${action}" with security PIN`,
      metadata: { action },
    });

    return NextResponse.json({ success: true, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    console.error('[super-admin/security-pin/gate POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

const lockSchema = z.object({ action: z.string().min(1) });

// Manual "Lock now" — lets an admin re-lock a gated tool before the unlock
// window naturally expires.
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = lockSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });

  await revokeUnlock(session.user.id, parsed.data.action);
  return NextResponse.json({ success: true });
}
