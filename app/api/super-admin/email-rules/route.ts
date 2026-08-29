import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { EmailAudience, EmailFrequency, EmailReportType, Prisma } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/permissions';
import { isEmailConfigured, cleanAddresses } from '@/lib/email';
import { isActionUnlocked } from '@/lib/security-pin';
import { PIN_GATED_ACTIONS } from '@/lib/pin-gated-actions';
import { runEmailRule } from '@/lib/email-runner';

/**
 * Scheduled-email rules. Super Admin only — a rule decides who receives company
 * performance data, which is not something a team lead should be able to widen.
 */

const addressList = z
  .array(z.object({ emailid: z.string().trim().email(), name: z.string().trim().max(120).optional() }))
  .max(50)
  .default([]);

const ruleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  reportType: z.nativeEnum(EmailReportType),
  // Blank means "use the report's own subject". Kept literal — no date tokens,
  // because a subject that changes per send is exactly what stops the mail
  // threading, which is the reason it is constant in the first place.
  subject: z.string().trim().max(200).optional().nullable(),
  frequency: z.nativeEnum(EmailFrequency),
  sendHour: z.number().int().min(0).max(23),
  sendMinute: z.number().int().min(0).max(59),
  // 1 = Monday … 7 = Sunday.
  weekday: z.number().int().min(1).max(7).nullable().optional(),
  // Capped at 28 so a monthly rule cannot silently skip February.
  dayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
  audience: z.nativeEnum(EmailAudience),
  toEmails: addressList,
  toRoles: z.array(z.string()).max(10).default([]),
  ccEmails: addressList,
  ccRoles: z.array(z.string()).max(10).default([]),
  bccEmails: addressList,
  scopeTlId: z.string().nullable().optional(),
  attachCsv: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

/**
 * Super Admin *and* an unlocked security PIN.
 *
 * Enforced on the server, not only in the UI: the gate is meaningless if the
 * endpoints behind it answer a plain fetch. A rule can send company performance
 * data to any address, which is the same class of power as an API key.
 */
async function requireSuperAdmin() {
  const session = await getServerSession(authOptions);
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (session.user.role !== 'SUPER_ADMIN') {
    return { error: NextResponse.json({ error: 'Only a Super Admin can manage email automation' }, { status: 403 }) };
  }
  if (!(await isActionUnlocked(session.user.id, PIN_GATED_ACTIONS.EMAIL_AUTOMATION))) {
    return {
      error: NextResponse.json(
        { error: 'This tool is PIN-locked — verify your security PIN first', code: 'PIN_LOCKED' },
        { status: 423 },
      ),
    };
  }
  return { session };
}

/** Catches the combinations that would produce an email nobody receives. */
function validateAudience(d: z.infer<typeof ruleSchema>): string | null {
  if (d.reportType === 'AGENT_PERFORMANCE' && d.audience !== 'EACH_AGENT') {
    return 'An agent performance email must be addressed to each agent — that is what makes it personal.';
  }
  if (d.reportType === 'WELCOME' && d.audience !== 'EACH_AGENT') {
    return 'A welcome email carries one person’s own login details, so it goes to each agent individually. Use Cc to copy a manager.';
  }
  // Every management report is a whole-floor view, so none of them can be
  // addressed to each agent individually. Listed rather than negated against
  // the per-person types, so a future report type has to make its own choice
  // instead of silently inheriting one.
  const MANAGEMENT_REPORTS = [
    'TEAM_SUMMARY', 'FEEDBACK_SUMMARY', 'COLLEGE_WISE', 'AGENT_WISE', 'OVERALL_CALLING',
    'ALL_REPORTS',
  ];
  if (MANAGEMENT_REPORTS.includes(d.reportType) && d.audience === 'EACH_AGENT') {
    return 'This report covers the whole floor, so it cannot be addressed to each agent individually.';
  }
  if (d.audience === 'FIXED' && d.toEmails.length === 0) {
    return 'Add at least one recipient address.';
  }
  if (d.audience === 'BY_ROLE' && d.toRoles.length === 0) {
    return 'Choose at least one role to send to.';
  }
  if (d.frequency === 'WEEKLY' && !d.weekday) return 'Choose which day of the week to send on.';
  if ((d.frequency === 'MONTHLY' || d.frequency === 'QUARTERLY') && !d.dayOfMonth) {
    return 'Choose which day of the month to send on.';
  }
  return null;
}

export async function GET() {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  try {
    const [rules, tls, logs] = await Promise.all([
      prisma.emailRule.findMany({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: { scopeTl: { select: { id: true, name: true } } },
      }),
      prisma.user.findMany({
        where: { role: 'COUNSELLING_TL', isActive: true },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      prisma.emailLog.findMany({
        orderBy: { sentAt: 'desc' },
        take: 50,
        select: {
          id: true, subject: true, toEmails: true, success: true, error: true,
          providerGuid: true, periodLabel: true, sentAt: true,
          rule: { select: { name: true } },
        },
      }),
    ]);

    return NextResponse.json({
      rules,
      teamLeads: tls,
      logs,
      configured: isEmailConfigured(),
      fromAddress: process.env.EMAIL_FROM_ADDRESS ?? null,
    });
  } catch (err) {
    console.error('[email-rules GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  const parsed = ruleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const problem = validateAudience(parsed.data);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const d = parsed.data;
    const rule = await prisma.emailRule.create({
      data: {
        ...d,
        toEmails: cleanAddresses(d.toEmails) as unknown as Prisma.InputJsonValue,
        ccEmails: cleanAddresses(d.ccEmails) as unknown as Prisma.InputJsonValue,
        bccEmails: cleanAddresses(d.bccEmails) as unknown as Prisma.InputJsonValue,
        createdById: guard.session!.user.id,
      },
    });
    await logActivity({
      userId: guard.session!.user.id, action: 'PERMISSION_CHANGED',
      targetId: rule.id, targetType: 'EmailRule',
      description: `Created email rule "${rule.name}"`,
    });
    return NextResponse.json({ success: true, rule });
  } catch (err) {
    console.error('[email-rules POST]', err);
    return NextResponse.json({ error: 'Could not save this rule' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;

  const body = await req.json().catch(() => null);
  const id = (body as { id?: string } | null)?.id;
  if (!id) return NextResponse.json({ error: 'A rule id is required' }, { status: 400 });
  const parsed = ruleSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const problem = validateAudience(parsed.data);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  try {
    const d = parsed.data;
    const rule = await prisma.emailRule.update({
      where: { id },
      data: {
        ...d,
        toEmails: cleanAddresses(d.toEmails) as unknown as Prisma.InputJsonValue,
        ccEmails: cleanAddresses(d.ccEmails) as unknown as Prisma.InputJsonValue,
        bccEmails: cleanAddresses(d.bccEmails) as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ success: true, rule });
  } catch (err) {
    console.error('[email-rules PATCH]', err);
    return NextResponse.json({ error: 'Could not update this rule' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'A rule id is required' }, { status: 400 });
  try {
    await prisma.emailRule.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[email-rules DELETE]', err);
    return NextResponse.json({ error: 'Could not delete this rule' }, { status: 500 });
  }
}

/**
 * "Send now" — runs a saved rule immediately.
 *
 * Deliberately the same code path as the scheduler, so a passing test says
 * something real about the scheduled send. It does not consume the period slot,
 * so testing a rule cannot cancel that day's genuine delivery.
 */
export async function PUT(req: NextRequest) {
  const guard = await requireSuperAdmin();
  if (guard.error) return guard.error;
  const id = (await req.json().catch(() => null) as { id?: string } | null)?.id;
  if (!id) return NextResponse.json({ error: 'A rule id is required' }, { status: 400 });

  const rule = await prisma.emailRule.findUnique({ where: { id } });
  if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 });

  try {
    const outcome = await runEmailRule(prisma, rule, new Date(), false);
    return NextResponse.json({ success: true, outcome });
  } catch (err) {
    console.error('[email-rules PUT]', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Send failed' }, { status: 500 });
  }
}
