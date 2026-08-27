import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { COLLEGE_ZONES, COLLEGE_DEAL_TYPES } from '@/lib/college-attributes';
import { checkLandingPageUrl } from '@/lib/landing-page';
import { applyLeadCodeMapping } from '@/lib/lead-code';
import { DropdownType } from '@prisma/client';

const VALID_TYPES = Object.values(DropdownType);

const createSchema = z.object({
  type:           z.nativeEnum(DropdownType),
  value:          z.string().min(1).max(200),
  kappCollegeId:  z.string().min(1).max(100).optional(),
  // COLLEGE only — copied onto every lead ingested for this college. Restricted
  // to the fixed lists in lib/college-attributes.ts, the same source the Manage
  // Colleges dropdowns render from. '' is accepted and stored as NULL, which is
  // how an admin clears the value.
  collegeZone:     z.enum(['', ...COLLEGE_ZONES]).optional().nullable(),
  collegeDealType: z.enum(['', ...COLLEGE_DEAL_TYPES]).optional().nullable(),
  // COLLEGE only. Shape-checked below rather than here so the admin gets a
  // sentence explaining what is wrong instead of a zod field error.
  landingPageUrl:  z.string().max(1000).optional().nullable(),
  // LEAD_CODE only. Checked against the live Data Calling Type list below
  // rather than an enum here, because an admin maintains that list.
  leadCodeCallingType: z.string().max(200).optional().nullable(),
});

/**
 * A lead-code mapping may only point at a Data Calling Type that exists and is
 * active. Without this an admin could map a code to a value CSV upload would
 * then reject, and the two screens would quietly disagree about what is legal.
 */
async function checkCallingType(value: string | null | undefined): Promise<string | null> {
  const v = value?.trim();
  if (!v) return null;
  const hit = await prisma.dropdownOption.findFirst({
    where: { type: 'DATA_CALLING_TYPE', isActive: true, value: { equals: v, mode: 'insensitive' } },
    select: { value: true },
  });
  if (!hit) throw new Error(`"${v}" is not an active Data Calling Type`);
  // Stored exactly as the Data Calling Type list spells it, so the value written
  // onto leads matches the filter list character for character.
  return hit.value;
}

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
  select: { id: true, type: true, value: true, kappCollegeId: true, collegeZone: true, collegeDealType: true, landingPageUrl: true, leadCodeCallingType: true, isActive: true, createdAt: true },
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

  const landingCheck = checkLandingPageUrl(parsed.data.landingPageUrl ?? '');
  if (!landingCheck.ok) {
    return NextResponse.json({ error: landingCheck.error }, { status: 400 });
  }

  let callingType: string | null = null;
  try {
    callingType = await checkCallingType(parsed.data.leadCodeCallingType);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
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
        // Stored only for COLLEGE rows; blank means "not configured", which
        // leaves the corresponding lead field null rather than empty-string.
        collegeZone:     parsed.data.type === 'COLLEGE' ? (parsed.data.collegeZone || null) : null,
        collegeDealType: parsed.data.type === 'COLLEGE' ? (parsed.data.collegeDealType || null) : null,
        landingPageUrl:  parsed.data.type === 'COLLEGE' ? (parsed.data.landingPageUrl?.trim() || null) : null,
        leadCodeCallingType: parsed.data.type === 'LEAD_CODE' ? callingType : null,
        createdBy:     session.user.id,
      },
    });
    // Push it onto the leads immediately: the admin's mental model is "this code
    // is P1 now", not "new leads will be P1". The count goes back so the UI can
    // say how many were actually changed.
    const leadsUpdated = option.type === 'LEAD_CODE'
      ? await applyLeadCodeMapping(prisma, option.value, callingType)
      : 0;
    return NextResponse.json({ ...option, leadsUpdated }, { status: 201 });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'This value already exists for this type' }, { status: 409 });
    }
    console.error('[dropdown-options POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
