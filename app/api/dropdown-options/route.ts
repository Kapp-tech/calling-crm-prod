import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { DropdownType } from '@prisma/client';

const VALID_TYPES = Object.values(DropdownType);

const createSchema = z.object({
  type:           z.nativeEnum(DropdownType),
  value:          z.string().min(1).max(200),
  kappCollegeId:  z.string().min(1).max(100).optional(),
});

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const typeParam = searchParams.get('type');
  const showAll   = session.user.role === 'SUPER_ADMIN' && searchParams.get('all') === '1';

  if (typeParam && !VALID_TYPES.includes(typeParam as DropdownType)) {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
  }

  try {
    const options = await prisma.dropdownOption.findMany({
      where: {
        ...(typeParam ? { type: typeParam as DropdownType } : {}),
        ...(showAll ? {} : { isActive: true }),
      },
      orderBy: [{ value: 'asc' }],
      select: { id: true, type: true, value: true, kappCollegeId: true, isActive: true, createdAt: true },
    });
    return NextResponse.json(options);
  } catch (err) {
    console.error('[dropdown-options GET]', err);
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

  // For COLLEGE type, kappCollegeId is required
  if (parsed.data.type === 'COLLEGE' && !parsed.data.kappCollegeId?.trim()) {
    return NextResponse.json({ error: 'KAPP College ID is required for colleges' }, { status: 400 });
  }

  // Ensure kappCollegeId is unique within COLLEGE type
  if (parsed.data.type === 'COLLEGE' && parsed.data.kappCollegeId) {
    const existing = await prisma.dropdownOption.findFirst({
      where: { type: 'COLLEGE', kappCollegeId: parsed.data.kappCollegeId.trim() },
    });
    if (existing) {
      return NextResponse.json({ error: 'A college with this KAPP College ID already exists' }, { status: 409 });
    }
  }

  try {
    const option = await prisma.dropdownOption.create({
      data: {
        type:          parsed.data.type,
        value:         parsed.data.value.trim(),
        kappCollegeId: parsed.data.kappCollegeId?.trim() ?? null,
        createdBy:     session.user.id,
      },
    });
    return NextResponse.json(option, { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'This value already exists for this type' }, { status: 409 });
    }
    console.error('[dropdown-options POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
