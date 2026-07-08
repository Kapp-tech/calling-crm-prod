import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';

const nullableString = z.string().max(200).nullable();

const schema = z.object({
  altEmail1:   nullableString,
  altEmail2:   nullableString,
  altPhone1:   nullableString,
  altPhone2:   nullableString,
  correctCity:  nullableString,
  correctState: nullableString,
  parentName:   nullableString,
  parentMobile: nullableString,
  gender:       nullableString,
  classYear:    nullableString,
  category:     nullableString,
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const toNull = (v: string | null) => (v === '' || v == null ? null : v.trim());

    const updated = await prisma.lead.update({
      where: { id: params.id },
      data: {
        altEmail1:   toNull(parsed.data.altEmail1),
        altEmail2:   toNull(parsed.data.altEmail2),
        altPhone1:   toNull(parsed.data.altPhone1),
        altPhone2:   toNull(parsed.data.altPhone2),
        correctCity:  toNull(parsed.data.correctCity),
        correctState: toNull(parsed.data.correctState),
        parentName:   toNull(parsed.data.parentName),
        parentMobile: toNull(parsed.data.parentMobile),
        gender:       toNull(parsed.data.gender),
        classYear:    toNull(parsed.data.classYear),
        category:     toNull(parsed.data.category),
      },
      select: {
        altEmail1: true, altEmail2: true,
        altPhone1: true, altPhone2: true,
        correctCity: true, correctState: true,
        parentName: true, parentMobile: true,
        gender: true, classYear: true, category: true,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[leads/[id]/student-details PATCH]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
