import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { leadIntegrationSchema } from '@/lib/lead-integration-validation';
import { prepareHeadersForStorage, sanitizeHeadersForClient, type IntegrationHeader } from '@/lib/lead-integration-engine';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const integration = await prisma.leadIntegration.findUnique({
      where: { id: params.id },
      include: { createdBy: { select: { id: true, name: true } } },
    });
    if (!integration) return NextResponse.json({ error: 'Integration not found' }, { status: 404 });

    return NextResponse.json({
      ...integration,
      headers: sanitizeHeadersForClient((integration.headers as unknown as IntegrationHeader[]) ?? []),
    });
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id] GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const existing = await prisma.leadIntegration.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: 'Integration not found' }, { status: 404 });

    const body = await req.json().catch(() => null);
    const parsed = leadIntegrationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors[0]?.message ?? 'Invalid data' }, { status: 400 });
    }
    const d = parsed.data;
    const existingHeaders = (existing.headers as unknown as IntegrationHeader[]) ?? [];

    const updated = await prisma.leadIntegration.update({
      where: { id: params.id },
      data: {
        name: d.name,
        isActive: d.isActive ?? existing.isActive,
        trigger: d.trigger,
        method: d.method,
        url: d.url,
        headers: prepareHeadersForStorage(d.headers, existingHeaders) as unknown as Prisma.InputJsonValue,
        queryParams: d.queryParams as unknown as Prisma.InputJsonValue,
        bodyTemplate: d.bodyTemplate,
        timeoutMs: d.timeoutMs,
      },
    });

    await logActivity({
      userId: session.user.id,
      action: 'LEAD_INTEGRATION_UPDATED',
      targetId: updated.id,
      targetType: 'LeadIntegration',
      description: `Updated lead integration "${updated.name}"`,
    });

    return NextResponse.json({ ...updated, headers: sanitizeHeadersForClient(d.headers) });
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id] PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.LEAD_INTEGRATIONS))) {
      return NextResponse.json({ error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' }, { status: 423 });
    }

    const integration = await prisma.leadIntegration.findUnique({ where: { id: params.id } });
    if (!integration) return NextResponse.json({ error: 'Integration not found' }, { status: 404 });

    await prisma.leadIntegration.delete({ where: { id: params.id } });

    await logActivity({
      userId: session.user.id,
      action: 'LEAD_INTEGRATION_DELETED',
      targetId: integration.id,
      targetType: 'LeadIntegration',
      description: `Deleted lead integration "${integration.name}"`,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[super-admin/lead-integrations/[id] DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
