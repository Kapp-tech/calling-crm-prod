import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { collegeSessionConflict } from '@/lib/college-session';
import { COLLEGE_ZONES, COLLEGE_DEAL_TYPES, COLLEGE_CLIENT_TYPES } from '@/lib/college-attributes';
import { checkLandingPageUrl } from '@/lib/landing-page';
import { applyLeadCodeMapping } from '@/lib/lead-code';

const updateSchema = z.object({
  value:         z.string().min(1).max(200).optional(),
  kappCollegeId: z.string().min(1).max(100).optional(),
  // COLLEGE only — see the note in ../route.ts. '' clears the value back to
  // "not configured"; anything outside the fixed lists is rejected.
  collegeZone:     z.enum(['', ...COLLEGE_ZONES]).optional().nullable(),
  collegeDealType: z.enum(['', ...COLLEGE_DEAL_TYPES]).optional().nullable(),
  collegeClientType: z.enum(['', ...COLLEGE_CLIENT_TYPES]).optional().nullable(),
  // COLLEGE only. Free text on purpose: a session is written "2027" by some
  // colleges and "2026-27" by others, so a 4-digit rule would reject a
  // legitimate value. Length-capped and trimmed, nothing more.
  collegeSessionYear: z.string().max(20).optional().nullable(),
  landingPageUrl:  z.string().max(1000).optional().nullable(),
  leadCodeCallingType: z.string().max(200).optional().nullable(),
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
  const { collegeZone, collegeDealType, collegeClientType, collegeSessionYear, landingPageUrl, leadCodeCallingType, ...rest } = parsed.data;
  const data: Prisma.DropdownOptionUpdateInput = { ...rest };
  if (collegeZone !== undefined) data.collegeZone = collegeZone || null;
  if (collegeDealType !== undefined) data.collegeDealType = collegeDealType || null;
  if (collegeClientType !== undefined) data.collegeClientType = collegeClientType || null;
  // Trimmed here because, unlike the enum fields, this one is free text.
  if (collegeSessionYear !== undefined) data.collegeSessionYear = collegeSessionYear?.trim() || null;
  if (landingPageUrl !== undefined) {
    const check = checkLandingPageUrl(landingPageUrl ?? '');
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    data.landingPageUrl = landingPageUrl?.trim() || null;
  }

  // Same rule as on create: only an active Data Calling Type may be mapped.
  if (leadCodeCallingType !== undefined) {
    const v = leadCodeCallingType?.trim();
    if (v) {
      const hit = await prisma.dropdownOption.findFirst({
        where: { type: 'DATA_CALLING_TYPE', isActive: true, value: { equals: v, mode: 'insensitive' } },
        select: { value: true },
      });
      if (!hit) {
        return NextResponse.json({ error: `"${v}" is not an active Data Calling Type` }, { status: 400 });
      }
      data.leadCodeCallingType = hit.value;
    } else {
      data.leadCodeCallingType = null;
    }
  }

  /**
   * The same rule on edit, or it is trivially sidestepped: create 2027 while
   * 2026 is off, then switch 2026 back on and both are live.
   *
   * `kappCollegeId` is not in this schema, so a row cannot move to another ID
   * here — only its Session/Year and its active flag are in play, and each
   * check runs only when its input is being touched.
   */
  const activating = rest.isActive === true;
  const changingYear = collegeSessionYear !== undefined;
  if (activating || changingYear) {
    const self = await prisma.dropdownOption.findUnique({
      where: { id: params.id },
      select: { type: true, kappCollegeId: true },
    });
    if (self?.type === 'COLLEGE' && self.kappCollegeId) {
      const siblings = await prisma.dropdownOption.findMany({
        where: { type: 'COLLEGE', kappCollegeId: self.kappCollegeId, id: { not: params.id } },
        select: { value: true, collegeSessionYear: true, isActive: true },
      });
      const conflict = collegeSessionConflict(self.kappCollegeId, siblings, {
        ...(changingYear ? { year: collegeSessionYear ?? null } : {}),
        activating,
      });
      if (conflict) return NextResponse.json({ error: conflict }, { status: 409 });
    }
  }

  try {
    const option = await prisma.dropdownOption.update({
      where: { id: params.id },
      data,
    });
    const leadsUpdated = option.type === 'LEAD_CODE'
      ? await applyLeadCodeMapping(prisma, option.value, option.leadCodeCallingType)
      : 0;
    return NextResponse.json({ ...option, leadsUpdated });
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      // For a college the key includes the session year, so say so — "already
      // exists" alone reads as a flat refusal when a different year is allowed.
      return NextResponse.json({
        error: 'Another entry already uses this name'
          + (collegeSessionYear !== undefined ? ' for that Session/Year' : ' for this type'),
      }, { status: 409 });
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
