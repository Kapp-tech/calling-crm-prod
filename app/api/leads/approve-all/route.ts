import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hasPermission, logActivity } from '@/lib/permissions';
import { getLeadWhereClause, validateLeadForApproval } from '@/lib/lead-access';
import { Feature } from '@prisma/client';

// Approves every PENDING lead visible to this user (optionally narrowed by
// the same `search` text the Lead Approvals page is currently filtered by),
// not just whatever page of results happens to be on screen.
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const canApprove = await hasPermission(session.user.role, Feature.APPROVE_LEADS);
    if (!canApprove) return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    const search = new URL(req.url).searchParams.get('search')?.trim();

    // Combined via AND (not spread) so this can never silently clobber an
    // OR clause already present in the role-based scope (e.g. COUNSELLING_TL).
    const where: Prisma.LeadWhereInput = {
      AND: [
        getLeadWhereClause(session.user),
        { status: 'PENDING' },
        ...(search
          ? [{
              OR: [
                { id:    { contains: search, mode: Prisma.QueryMode.insensitive } },
                { name:  { contains: search, mode: Prisma.QueryMode.insensitive } },
                { email: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { phone: { contains: search, mode: Prisma.QueryMode.insensitive } },
                { city:  { contains: search, mode: Prisma.QueryMode.insensitive } },
              ],
            }]
          : []),
      ],
    };

    const leads = await prisma.lead.findMany({
      where,
      select: { id: true, name: true, email: true, phone: true, course: true },
    });

    if (leads.length === 0) {
      return NextResponse.json({ success: false, error: 'No pending leads found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const valid: string[] = [];
    const invalid: { id: string; name: string; reason: string }[] = [];
    for (const lead of leads) {
      const err = validateLeadForApproval(lead);
      if (err) invalid.push({ id: lead.id, name: lead.name, reason: err });
      else valid.push(lead.id);
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      if (valid.length > 0) {
        await tx.lead.updateMany({
          where: { id: { in: valid } },
          data: { status: 'APPROVED', approvedById: session.user.id, approvedAt: now },
        });
      }

      await logActivity({
        userId: session.user.id,
        action: 'BATCH_APPROVED',
        targetId: 'bulk',
        targetType: 'Lead',
        description: `Bulk-approved ${valid.length} leads (${invalid.length} skipped due to validation)`,
        metadata: { approvedCount: valid.length, skippedCount: invalid.length, search: search ?? null },
      });
    });

    return NextResponse.json({
      success: true,
      approved: valid.length,
      skipped: invalid.length,
      invalidLeads: invalid,
    });
  } catch (error) {
    console.error('[leads/approve-all PATCH]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
