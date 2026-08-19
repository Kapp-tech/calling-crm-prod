import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { KpiSource, ReceiptType } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';

/**
 * Create, edit and delete KPI definitions.
 *
 * A KPI is configuration, so adding one is a form rather than a release. Only a
 * Super Admin may change them — they decide what everyone is measured on.
 */

const bodySchema = z.object({
  name: z.string().trim().min(2).max(60),
  unit: z.string().trim().max(20).default(''),
  source: z.nativeEnum(KpiSource),
  feedbackOptionIds: z.array(z.string()).max(200).default([]),
  feedbackCategoryIds: z.array(z.string()).max(50).default([]),
  leadStages: z.array(z.string().trim().min(1)).max(50).default([]),
  receiptType: z.nativeEnum(ReceiptType).nullable().default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

/**
 * Drops config that does not belong to the chosen source.
 *
 * Without this, switching a KPI from "leads at a stage" to "feedback logged"
 * would leave the old stage list behind — invisible in the UI but still stored,
 * and liable to change the meaning of the KPI if the source were switched back.
 */
function normalise(input: z.infer<typeof bodySchema>) {
  const usesFeedback = input.source === 'FEEDBACK_COUNT' || input.source === 'FEEDBACK_LEADS';
  return {
    name: input.name,
    unit: input.unit,
    source: input.source,
    feedbackOptionIds: usesFeedback ? input.feedbackOptionIds : [],
    feedbackCategoryIds: usesFeedback ? input.feedbackCategoryIds : [],
    leadStages: input.source === 'LEAD_STAGE_LIVE' ? input.leadStages : [],
    receiptType: input.source === 'RECEIPT_COUNT' ? input.receiptType : null,
    isActive: input.isActive,
    sortOrder: input.sortOrder,
  };
}

/** A stage-based KPI that names no stage would silently always read 0. */
function configError(d: ReturnType<typeof normalise>): string | null {
  if (d.source === 'LEAD_STAGE_LIVE' && d.leadStages.length === 0) {
    return 'Choose at least one Lead Stage for this KPI, otherwise it will always read zero.';
  }
  if (d.source === 'RECEIPT_COUNT' && !d.receiptType) {
    return 'Choose which receipt type this KPI counts.';
  }
  return null;
}

async function requireAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (session.user.role !== 'SUPER_ADMIN') {
    return { error: NextResponse.json({ error: 'Only a Super Admin can change KPIs' }, { status: 403 }) };
  }
  return { session };
}

export async function POST(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const data = normalise(parsed.data);
  const bad = configError(data);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  try {
    const created = await prisma.kpiDefinition.create({
      data: { ...data, createdById: session!.user.id },
      select: { id: true, name: true },
    });
    await logActivity({
      userId: session!.user.id,
      action: 'PERMISSION_CHANGED',
      targetId: created.id,
      targetType: 'KpiDefinition',
      description: `Created KPI "${created.name}"`,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A KPI with that name already exists' }, { status: 409 });
    }
    console.error('[kpi/definitions POST]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;

  const withId = bodySchema.extend({ id: z.string().min(1) });
  const parsed = withId.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { id, ...rest } = parsed.data;
  const data = normalise(rest);
  const bad = configError(data);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });

  try {
    const updated = await prisma.kpiDefinition.update({
      where: { id },
      data,
      select: { id: true, name: true },
    });
    await logActivity({
      userId: session!.user.id,
      action: 'PERMISSION_CHANGED',
      targetId: id,
      targetType: 'KpiDefinition',
      description: `Updated KPI "${updated.name}"`,
    });
    return NextResponse.json(updated);
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'A KPI with that name already exists' }, { status: 409 });
    }
    if ((err as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'KPI not found' }, { status: 404 });
    }
    console.error('[kpi/definitions PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await requireAdmin();
  if (error) return error;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'An id is required' }, { status: 400 });

  try {
    // Targets cascade with the definition — a target for a KPI that no longer
    // exists would be unreachable clutter.
    const deleted = await prisma.kpiDefinition.delete({ where: { id }, select: { name: true } });
    await logActivity({
      userId: session!.user.id,
      action: 'PERMISSION_CHANGED',
      targetId: id,
      targetType: 'KpiDefinition',
      description: `Deleted KPI "${deleted.name}" and its targets`,
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2025') {
      return NextResponse.json({ error: 'KPI not found' }, { status: 404 });
    }
    console.error('[kpi/definitions DELETE]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
