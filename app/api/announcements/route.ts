import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const createSchema = z.object({
  title:    z.string().min(1).max(200),
  content:  z.string().min(1).max(5000),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
});

// GET — active announcements (TL + Agent) or all announcements (SA)
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const all = searchParams.get('all') === '1'; // SA-only: fetch inactive too

  try {
    const isSA = session.user.role === 'SUPER_ADMIN';

    const announcements = await prisma.announcement.findMany({
      where: isSA && all ? {} : { isActive: true },
      orderBy: [
        // URGENT first, then HIGH, NORMAL, LOW
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        author: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(announcements);
  } catch (err) {
    console.error('[announcements GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST — create announcement (SA only)
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const announcement = await prisma.announcement.create({
      data: {
        ...parsed.data,
        createdBy: session.user.id,
      },
      include: { author: { select: { id: true, name: true } } },
    });

    return NextResponse.json(announcement, { status: 201 });
  } catch (err) {
    console.error('[announcements POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
