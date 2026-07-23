import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { generateApiKey } from '@/lib/api-key';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

// Managing integration credentials is Super-Admin-only, same as Manage
// Permissions and Activity Logs — not part of the feature permission matrix.
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.API_KEYS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        createdBy: { select: { id: true, name: true } },
        _count: { select: { leads: true } },
      },
    });

    // keyHash never leaves the server — only the display prefix does.
    const sanitized = keys.map(({ keyHash: _keyHash, ...rest }) => rest);
    return NextResponse.json(sanitized);
  } catch (error) {
    console.error('[super-admin/api-keys GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.API_KEYS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const body = await req.json().catch(() => null);
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { rawKey, keyHash, keyPrefix } = generateApiKey();

    const key = await prisma.apiKey.create({
      data: { name: parsed.data.name, keyHash, keyPrefix, createdById: session.user.id },
    });

    await logActivity({
      userId: session.user.id,
      action: 'API_KEY_CREATED',
      targetId: key.id,
      targetType: 'ApiKey',
      description: `Created API key "${key.name}"`,
    });

    // rawKey is returned ONLY in this response — it is not recoverable after this.
    return NextResponse.json({ id: key.id, name: key.name, keyPrefix, rawKey, createdAt: key.createdAt }, { status: 201 });
  } catch (error) {
    console.error('[super-admin/api-keys POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
