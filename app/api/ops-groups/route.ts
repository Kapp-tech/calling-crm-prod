import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

const createSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional(),
  memberIds: z.array(z.string()).optional(),
});

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const groups = await prisma.operationsGroup.findMany({
      include: {
        manager: { select: { id: true, name: true } },
        members: { select: { id: true, name: true, email: true, employeeCode: true, isActive: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(groups);
  } catch (error) {
    console.error('[ops-groups GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.flatten(), code: 'VALIDATION_ERROR' }, { status: 400 });

    const { name, description, memberIds } = parsed.data;

    const group = await prisma.operationsGroup.create({
      data: {
        name,
        description,
        managerId: session.user.id,
        createdById: session.user.id,
        ...(memberIds?.length ? { members: { connect: memberIds.map((id) => ({ id })) } } : {}),
      },
      include: { members: { select: { id: true, name: true } } },
    });

    return NextResponse.json(group, { status: 201 });
  } catch (error) {
    console.error('[ops-groups POST]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
