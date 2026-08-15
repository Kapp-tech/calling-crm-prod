import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { canAccessLead } from '@/lib/lead-access';
import { logActivity } from '@/lib/permissions';
import { pushLeadToIntegrations } from '@/lib/lead-integration-engine';

// Referrals are captured by counsellors while talking to the lead
const REFERRAL_ROLES = ['SUPER_ADMIN', 'COUNSELLING_TL', 'COUNSELLING_AGENT'];

const referralSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  email: z.string().trim().email('Invalid email address').max(200),
  phone: z
    .string()
    .trim()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => /^\d{10}$/.test(v), 'Phone must be exactly 10 digits'),
  city: z.string().trim().min(1, 'City is required').max(200),
  state: z.string().trim().min(1, 'State is required').max(200),
  course: z.string().trim().min(1, 'Course is required').max(300),
  college: z.string().trim().min(1, 'College is required').max(300),
  kappCollegeId: z.string().trim().max(100).optional(),
  category: z.enum(['General', 'SC/ST', 'OBC', 'EWS']).optional().or(z.literal('')),
});

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const referrals = await prisma.lead.findMany({
      where: { referredById: params.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        city: true,
        state: true,
        course: true,
        college: true,
        createdAt: true,
        assignedTo: { select: { id: true, name: true } },
        integrationLogs: {
          orderBy: { attemptedAt: 'desc' },
          select: {
            id: true,
            success: true,
            isTest: true,
            responseStatus: true,
            responseBody: true,
            errorMessage: true,
            requestUrl: true,
            requestBody: true,
            attemptedAt: true,
            integration: { select: { name: true } },
          },
        },
      },
    });

    return NextResponse.json(referrals);
  } catch (error) {
    console.error('[leads/[id]/referrals GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    if (!REFERRAL_ROLES.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const allowed = await canAccessLead(session.user, params.id);
    if (!allowed) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const body = await req.json();
    const parsed = referralSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.errors[0]?.message ?? 'Invalid data';
      return NextResponse.json({ error: first }, { status: 400 });
    }
    const d = parsed.data;

    // Block obvious duplicates so two agents don't end up calling the same
    // person from two different lead rows.
    const existing = await prisma.lead.findFirst({
      where: { phone: d.phone },
      select: { id: true, name: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `A lead with this phone number already exists (${existing.name}, ${existing.id})` },
        { status: 409 }
      );
    }

    const referrer = await prisma.lead.findUnique({
      where: { id: params.id },
      select: { id: true, name: true, teamId: true },
    });
    if (!referrer) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const now = new Date();

    // The referred lead skips the usual upload → approval pipeline: it is
    // created APPROVED and assigned straight to the agent who captured it,
    // so they can immediately submit feedback on it.
    const referral = await prisma.$transaction(async (tx) => {
      const created = await tx.lead.create({
        data: {
          // Not @updatedAt any more (see schema.prisma) — a new lead reads as
          // its creation time until the first feedback advances it.
          updatedAt: new Date(),
          name: d.name,
          email: d.email,
          phone: d.phone,
          city: d.city,
          state: d.state,
          course: d.course,
          college: d.college,
          kappCollegeId: d.kappCollegeId || null,
          category: d.category || null,
          leadOrigin: 'Referral',
          referredById: referrer.id,

          status: 'APPROVED',
          approvedById: session.user.id,
          approvedAt: now,

          uploadedById: session.user.id,
          uploadedAt: now,

          assignedToId: session.user.id,
          assignedById: session.user.id,
          assignedAt: now,
          teamId: session.user.teamId ?? referrer.teamId ?? null,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          city: true,
          state: true,
          course: true,
          college: true,
          createdAt: true,
          assignedTo: { select: { id: true, name: true } },
        },
      });

      await logActivity({
        userId: session.user.id,
        action: 'REFERRAL_ADDED',
        targetId: created.id,
        targetType: 'Lead',
        description: `Referral lead "${d.name}" added via ${referrer.name} (${referrer.id}) and auto-assigned`,
      });

      return created;
    });

    // Fire-and-forget: this is a persistent Node process (not serverless),
    // so the push keeps running after the response below is sent. Never
    // awaited — a slow or down third-party LMS must not delay or break
    // referral capture for the counsellor.
    pushLeadToIntegrations(referral.id, 'REFERRAL_CREATED').catch((err) =>
      console.error('[leads/[id]/referrals POST] integration push failed', err)
    );

    return NextResponse.json(referral, { status: 201 });
  } catch (error) {
    console.error('[leads/[id]/referrals POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
