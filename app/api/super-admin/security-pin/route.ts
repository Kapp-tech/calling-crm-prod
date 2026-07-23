import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { hashPin, isValidPinFormat } from '@/lib/security-pin';

// Self-service Security PIN management for the logged-in Super Admin's own
// profile page. Setting/changing the PIN always requires the account
// PASSWORD (proves it's really them), plus the OLD PIN if one is already
// configured (proves continuity — a stolen session alone can't rotate it).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { securityPinHash: true, securityPinSetAt: true },
  });

  return NextResponse.json({
    isSet: !!user?.securityPinHash,
    setAt: user?.securityPinSetAt?.toISOString() ?? null,
  });
}

const schema = z.object({
  password: z.string().min(1, 'Your account password is required'),
  oldPin: z.string().optional(),
  newPin: z.string().min(1, 'New PIN is required'),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, { status: 400 });
    }
    const { password, oldPin, newPin } = parsed.data;

    if (!isValidPinFormat(newPin)) {
      return NextResponse.json({ success: false, error: 'PIN must be exactly 6 digits' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { password: true, securityPinHash: true },
    });
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });

    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) {
      return NextResponse.json({ success: false, error: 'Your account password is incorrect' }, { status: 400 });
    }

    if (user.securityPinHash) {
      // A PIN is already set — changing it requires proving the old one too.
      if (!oldPin) {
        return NextResponse.json({ success: false, error: 'Your current PIN is required to change it' }, { status: 400 });
      }
      const oldPinOk = await bcrypt.compare(oldPin, user.securityPinHash);
      if (!oldPinOk) {
        return NextResponse.json({ success: false, error: 'Your current PIN is incorrect' }, { status: 400 });
      }
    }

    const newPinHash = await hashPin(newPin);
    await prisma.user.update({
      where: { id: session.user.id },
      data: {
        securityPinHash: newPinHash,
        securityPinSetAt: new Date(),
        securityPinFailedAttempts: 0,
        securityPinLockedUntil: null,
      },
    });

    await logActivity({
      userId: session.user.id,
      action: 'SECURITY_PIN_CHANGED',
      targetId: session.user.id,
      targetType: 'User',
      description: user.securityPinHash ? 'Changed their security PIN' : 'Set up a security PIN',
    });

    return NextResponse.json({ success: true, message: user.securityPinHash ? 'PIN updated' : 'PIN set' });
  } catch (error) {
    console.error('[super-admin/security-pin POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
