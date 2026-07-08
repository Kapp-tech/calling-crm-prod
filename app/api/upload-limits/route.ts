import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const SETTING_KEY = 'upload_limit_per_batch';

// GET — returns the global per-upload row limit
export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const parsed  = setting ? parseInt(setting.value, 10) : null;
    const uploadLimit = parsed && !isNaN(parsed) ? parsed : null;

    return NextResponse.json({ uploadLimit });
  } catch (err) {
    console.error('[upload-limits GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH — super admin sets the global per-upload row limit
const patchSchema = z.object({
  uploadLimit: z.number().int().min(1).nullable(),
});

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { uploadLimit } = parsed.data;

    if (uploadLimit === null) {
      await prisma.setting.deleteMany({ where: { key: SETTING_KEY } });
    } else {
      await prisma.setting.upsert({
        where:  { key: SETTING_KEY },
        create: { key: SETTING_KEY, value: String(uploadLimit) },
        update: { value: String(uploadLimit) },
      });
    }

    return NextResponse.json({ success: true, uploadLimit });
  } catch (err) {
    console.error('[upload-limits PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
