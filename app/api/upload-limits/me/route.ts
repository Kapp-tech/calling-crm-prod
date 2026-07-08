import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const SETTING_KEY = 'upload_limit_per_batch';

export async function GET(_req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const setting = await prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    const parsed  = setting ? parseInt(setting.value, 10) : null;
    const uploadLimit = parsed && !isNaN(parsed) ? parsed : null;

    return NextResponse.json({ uploadLimit });
  } catch (err) {
    console.error('[upload-limits/me GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
