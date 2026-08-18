import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { COLLEGE_ZONES, COLLEGE_DEAL_TYPES } from '@/lib/college-attributes';

const updateSchema = z.object({
  value:         z.string().min(1).max(200).optional(),
  kappCollegeId: z.string().min(1).max(100).optional(),
  // COLLEGE only — see the note in ../route.ts. '' clears the value back to
  // "not configured"; anything outside the fixed lists is rejected.
  collegeZone:     z.enum(['', ...COLLEGE_ZONES]).optional().nullable(),
  collegeDealType: z.enum(['', ...COLLEGE_DEAL_TYPES]).optional().nullable(),
  isActive:      z.boolean().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Blank must land as NULL, not an empty string: an empty collegeZone means
  // "not configured" and should leave the lead's zone unset, whereas '' would be
  // copied onto every lead as a real (blank) value. No trimming needed — zod has
  // already restricted these to '' or an exact list member.
  const { collegeZone, collegeDealType, ...rest } = parsed.data;
  const data: Prisma.DropdownOptionUpdateInput = { ...rest };
  if (collegeZone !== undefined) data.collegeZone = collegeZone || null;
  if (collegeDealType !== undefined) data.collegeDealType = collegeDealType || null;

  try {
    const option = await prisma.dropdownOption.update({
      where: { id: params.id },
      data,
    });
    return NextResponse.json(option);
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'This value already exists for this type' }, { status: 409 });
    }
    console.error('[dropdown-options PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== 'SUPER_ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    await prisma.dropdownOption.delete({ where: { id: params.id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[dropdown-options DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
