import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { isMaskedRole } from '@/lib/permissions';
import { maskContact } from '@/lib/data-masking';
import { hasPermission } from '@/lib/permissions';
import { getLeadWhereClause } from '@/lib/lead-access';
import { Feature } from '@prisma/client';

// Returns EVERY pending lead in this one batch, uncapped — unlike the main
// /api/leads listing (capped at 100/page), this backs the "Download Pending"
// button so a batch with thousands of leads exports completely, not just
// whatever page happened to be loaded on screen.
export async function GET(req: NextRequest, { params }: { params: { batchId: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) return NextResponse.json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' }, { status: 401 });

    const canDownload = await hasPermission(session.user.role, Feature.DOWNLOAD_DATA);
    if (!canDownload) return NextResponse.json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    const accessClause = getLeadWhereClause(session.user);

    const leads = await prisma.lead.findMany({
      where: { AND: [accessClause, { batchId: params.batchId, status: 'PENDING' }] },
      select: {
        id: true, name: true, email: true, phone: true, city: true, state: true,
        course: true, college: true, campaign: true, leadType: true, leadOrigin: true,
        leadZone: true, status: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const masked = await isMaskedRole(session.user.role);
    return NextResponse.json({
      success: true,
      leads: masked ? leads.map((l) => maskContact(l, true)) : leads,
      masked,
    });
  } catch (error) {
    console.error('[leads/batch/[batchId]/pending GET]', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
