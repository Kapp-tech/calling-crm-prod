import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAllPermissions } from '@/lib/permissions';
import { Feature, Role } from '@prisma/client';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

const updatePermissionSchema = z.object({
  role: z.nativeEnum(Role),
  feature: z.nativeEnum(Feature),
  canAccess: z.boolean(),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.MANAGE_PERMISSIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const permissions = await getAllPermissions();
    return NextResponse.json(permissions);
  } catch (error) {
    console.error('[permissions GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.MANAGE_PERMISSIONS))) {
    return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
  }

  const body = await req.json();
  const parsed = updatePermissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { role, feature, canAccess } = parsed.data;

  /**
   * Super Admin keeps every permission except masking, which is theirs to set.
   *
   * Masking only hides lead contact details; it cannot hide this page, so a
   * Super Admin who masks themselves can always come back and unmask. Every
   * OTHER feature stays locked, and that is the part that matters — letting
   * Super Admin revoke, say, their own MANAGE_PERMISSIONS would be a genuine
   * lockout with no way back through the UI.
   */
  if (role === Role.SUPER_ADMIN && feature !== Feature.MASK_UNMASK_DATA) {
    return NextResponse.json(
      { error: 'Super Admin keeps every permission except Mask Data' },
      { status: 400 },
    );
  }

  const permission = await prisma.permission.upsert({
    where: { role_feature: { role, feature } },
    update: { canAccess },
    create: { role, feature, canAccess },
  });

  return NextResponse.json(permission);
  } catch (error) {
    console.error('[permissions PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
