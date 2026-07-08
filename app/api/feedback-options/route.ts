import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const createSchema = z.object({
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  categoryId: z.string().optional().nullable(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const showAll = session.user.role === 'SUPER_ADMIN' &&
    new URL(req.url).searchParams.get('all') === '1';

  try {
    const options = await prisma.feedbackOption.findMany({
      where: showAll ? {} : { isActive: true },
      orderBy: [{ label: 'asc' }],
      select: {
        id: true, label: true, description: true, isActive: true, createdAt: true,
        categoryId: true,
        category: { select: { id: true, name: true, color: true } },
      },
    });
    return NextResponse.json(options);
  } catch (err) {
    console.error('[feedback-options GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const option = await prisma.feedbackOption.create({
      data: {
        label: parsed.data.label,
        description: parsed.data.description,
        categoryId: parsed.data.categoryId || null,
        createdBy: session.user.id,
      },
    });
    return NextResponse.json(option, { status: 201 });
  } catch (err) {
    console.error('[feedback-options POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
