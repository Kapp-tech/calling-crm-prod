import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { HEX_COLOR_RE, DEFAULT_CATEGORY_COLOR } from '@/lib/feedback-category-colors';

const createSchema = z.object({
  name:  z.string().trim().min(1).max(50),
  color: z.string().regex(HEX_COLOR_RE, 'Color must be a hex value like #f59e0b').optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const showAll = session.user.role === 'SUPER_ADMIN' &&
    new URL(req.url).searchParams.get('all') === '1';

  try {
    const categories = await prisma.feedbackCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true, name: true, color: true, sortOrder: true, createdAt: true,
        _count: { select: { feedbackOptions: showAll ? true : { where: { isActive: true } } } },
      },
    });
    return NextResponse.json(categories);
  } catch (err) {
    console.error('[feedback-categories GET]', err);
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
    const category = await prisma.feedbackCategory.create({
      data: {
        name: parsed.data.name,
        color: parsed.data.color ?? DEFAULT_CATEGORY_COLOR,
        createdBy: session.user.id,
      },
    });
    return NextResponse.json(category, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'P2002') {
      return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 });
    }
    console.error('[feedback-categories POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
