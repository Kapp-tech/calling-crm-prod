import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

// Revoke a key. Deliberately no way to "un-revoke" — if it's needed again,
// generate a fresh one. Deliberately no hard delete either, so leads already
// attributed to this key (Lead.apiKeyId) keep their audit trail.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.API_KEYS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const body = await req.json().catch(() => null);
    if (body?.action !== 'REVOKE') {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
    }

    const key = await prisma.apiKey.findUnique({ where: { id: params.id } });
    if (!key) return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    if (!key.isActive) return NextResponse.json({ error: 'Key is already revoked' }, { status: 409 });

    const updated = await prisma.apiKey.update({
      where: { id: params.id },
      data: { isActive: false, revokedAt: new Date() },
    });

    await logActivity({
      userId: session.user.id,
      action: 'API_KEY_REVOKED',
      targetId: key.id,
      targetType: 'ApiKey',
      description: `Revoked API key "${key.name}"`,
    });

    const { keyHash: _keyHash, ...sanitized } = updated;
    return NextResponse.json(sanitized);
  } catch (error) {
    console.error('[super-admin/api-keys/[id] PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
