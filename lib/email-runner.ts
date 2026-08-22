import { EmailRule, Prisma, PrismaClient } from '@prisma/client';
import { sendEmail, EmailAddress, isEmailConfigured } from './email';
import { buildAgentEmail, buildTeamSummary } from './email-reports';
import { buildAgentReport } from './reports';
import { isRuleDue, periodKeyFor, reportWindowFor } from './email-schedule';

/**
 * Turning a saved rule into sent mail.
 *
 * Kept out of the route so the same path serves the scheduler and the "Send a
 * test now" button — a test that took a different code path would prove nothing
 * about the scheduled send.
 */

/** [{emailid, name}] as stored on the rule, defended against hand-edited JSON. */
function addressesFrom(value: Prisma.JsonValue | null): EmailAddress[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((v) => {
    if (!v || typeof v !== 'object') return [];
    const o = v as Record<string, unknown>;
    const emailid = typeof o.emailid === 'string' ? o.emailid : '';
    if (!emailid) return [];
    return [{ emailid, name: typeof o.name === 'string' ? o.name : undefined }];
  });
}

async function addressesForRoles(db: PrismaClient, roles: string[]): Promise<EmailAddress[]> {
  if (roles.length === 0) return [];
  const users = await db.user.findMany({
    where: { role: { in: roles as never }, isActive: true },
    select: { name: true, email: true },
  });
  return users.map((u) => ({ emailid: u.email, name: u.name }));
}

/** The agents a rule reports on. */
function scopeFor(rule: EmailRule): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { role: 'COUNSELLING_AGENT', isActive: true };
  if (!rule.scopeTlId) return base;
  return {
    AND: [
      base,
      { OR: [{ managedById: rule.scopeTlId }, { team: { teamLeadId: rule.scopeTlId } }] },
    ],
  };
}

export interface RunOutcome {
  ruleId: string;
  ruleName: string;
  sent: number;
  failed: number;
  skipped?: string;
}

/**
 * Runs one rule and records every send.
 *
 * `markPeriod` is false for a manual test, so trying one out does not consume
 * the day's scheduled slot and silently cancel the real send.
 */
export async function runEmailRule(
  db: PrismaClient,
  rule: EmailRule,
  now: Date,
  markPeriod: boolean,
): Promise<RunOutcome> {
  const out: RunOutcome = { ruleId: rule.id, ruleName: rule.name, sent: 0, failed: 0 };

  if (!isEmailConfigured()) {
    out.skipped = 'Email is not configured on this server';
    return out;
  }

  const cc = [
    ...addressesFrom(rule.ccEmails),
    ...(await addressesForRoles(db, rule.ccRoles)),
  ];
  const bcc = addressesFrom(rule.bccEmails);
  const window = reportWindowFor(rule.frequency, now);
  const stamp = `${rule.id.slice(-8)}-${window.from}-${Date.now()}`;

  const record = async (
    subject: string,
    to: EmailAddress[],
    result: Awaited<ReturnType<typeof sendEmail>>,
  ) => {
    await db.emailLog.create({
      data: {
        ruleId: rule.id,
        reportType: rule.reportType,
        periodLabel: window.label,
        subject,
        toEmails: to.map((a) => a.emailid),
        ccEmails: cc.map((a) => a.emailid),
        bccEmails: bcc.map((a) => a.emailid),
        success: result.success,
        providerGuid: result.guid ?? null,
        providerResponse: (result.raw ?? null) as Prisma.InputJsonValue,
        error: result.error ?? null,
      },
    });
    if (result.success) out.sent += 1;
    else out.failed += 1;
  };

  if (rule.reportType === 'AGENT_PERFORMANCE') {
    // One email per agent. Sent in series with a short pause: the box has under
    // 400 MB free and a burst of parallel sends is the kind of thing that takes
    // the whole app down at 9am.
    const { rows } = await buildAgentReport(db, scopeFor(rule), 'DATEWISE', window.from, window.to, now);
    const agents = await db.user.findMany({
      where: { id: { in: rows.map((r) => r.id) } },
      select: { id: true, email: true, name: true },
    });
    const emailOf = new Map(agents.map((a) => [a.id, a]));

    for (const row of rows) {
      const agent = emailOf.get(row.id);
      if (!agent?.email) continue;
      const built = buildAgentEmail(row, window.label);
      const to: EmailAddress[] = [{ emailid: agent.email, name: agent.name }];
      const result = await sendEmail({
        subject: built.subject, html: built.html, to, cc, bcc,
        messageId: `crm-${stamp}-${row.id.slice(-6)}`,
      });
      await record(built.subject, to, result);
      await new Promise((r) => setTimeout(r, 400));
    }
  } else {
    const built = await buildTeamSummary(db, scopeFor(rule), rule.frequency, now);
    let to: EmailAddress[] = [];
    if (rule.audience === 'FIXED') to = addressesFrom(rule.toEmails);
    else if (rule.audience === 'BY_ROLE') to = await addressesForRoles(db, rule.toRoles);
    else {
      // EACH_AGENT on a team summary would mail every agent the whole team's
      // numbers, which is not what anyone means by it.
      out.skipped = 'A team summary needs fixed addresses or roles, not "each agent"';
      return out;
    }

    if (to.length === 0) {
      out.skipped = 'No recipients resolved';
      return out;
    }

    const result = await sendEmail({
      subject: built.subject, html: built.html, to, cc, bcc,
      messageId: `crm-${stamp}`,
      attachments:
        rule.attachCsv && built.csv
          ? [
              {
                content: Buffer.from(built.csv, 'utf8').toString('base64'),
                filename: `team_performance_${window.from}.csv`,
                type: 'text/csv',
              },
            ]
          : undefined,
    });
    await record(built.subject, to, result);
  }

  if (markPeriod) {
    await db.emailRule.update({
      where: { id: rule.id },
      data: { lastPeriodKey: periodKeyFor(rule.frequency, now), lastRunAt: now },
    });
  }
  return out;
}

/** Every active rule whose scheduled moment has passed in the current period. */
export async function runDueEmailRules(db: PrismaClient, now: Date): Promise<RunOutcome[]> {
  const rules = await db.emailRule.findMany({ where: { isActive: true } });
  const outcomes: RunOutcome[] = [];
  for (const rule of rules) {
    if (!isRuleDue(rule, now)) continue;
    try {
      outcomes.push(await runEmailRule(db, rule, now, true));
    } catch (err) {
      // One broken rule must not stop the rest of the morning's mail.
      console.error(`[email-runner] rule ${rule.id} failed:`, err);
      outcomes.push({
        ruleId: rule.id, ruleName: rule.name, sent: 0, failed: 1,
        skipped: err instanceof Error ? err.message : 'Rule failed',
      });
    }
  }
  return outcomes;
}
