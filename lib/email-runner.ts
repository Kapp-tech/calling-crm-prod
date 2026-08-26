import { EmailRule, Prisma, PrismaClient } from '@prisma/client';
import { sendEmail, EmailAddress, isEmailConfigured } from './email';
import {
  buildAgentEmail, buildTeamSummary, buildAgentBlocks, buildWelcomeEmail,
  buildFeedbackSummaryEmail, buildCollegeWiseEmail,
} from './email-reports';
import { isRuleDue, periodKeyFor, reportWindowFor } from './email-schedule';
import { istDayKey } from './ist-time';

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

  if (rule.reportType === 'WELCOME') {
    // Re-sending the welcome. The password is unrecoverable by then — it is
    // bcrypt-hashed — so this variant tells the person to ask their manager
    // rather than pretending a field is missing.
    const people = await db.user.findMany({
      where: scopeFor(rule),
      select: { id: true, name: true, email: true, employeeCode: true },
      orderBy: { name: 'asc' },
    });
    if (people.length === 0) {
      out.skipped = 'No users in scope';
      return out;
    }
    for (const person of people) {
      const built = buildWelcomeEmail({
        name: person.name, employeeCode: person.employeeCode, email: person.email,
      });
      const to: EmailAddress[] = [{ emailid: person.email, name: person.name }];
      const result = await sendEmail({
        subject: built.subject, html: built.html, to, cc, bcc,
        messageId: `crm-${stamp}-w${person.id.slice(-6)}`,
      });
      await record(built.subject, to, result);
      await new Promise((r) => setTimeout(r, 400));
    }
  } else if (rule.reportType === 'AGENT_PERFORMANCE') {
    // One email per agent. Sent in series with a short pause: the box has under
    // 400 MB free and a burst of parallel sends is the kind of thing that takes
    // the whole app down at 9am.
    const today = istDayKey(now);
    const { blocks } = await buildAgentBlocks(db, scopeFor(rule), now);
    const agents = await db.user.findMany({
      where: { id: { in: blocks.map((b) => b.id) } },
      select: { id: true, email: true, name: true },
    });
    const emailOf = new Map(agents.map((a) => [a.id, a]));

    for (const block of blocks) {
      const agent = emailOf.get(block.id);
      if (!agent?.email) continue;
      const built = buildAgentEmail(block, today);
      const to: EmailAddress[] = [{ emailid: agent.email, name: agent.name }];
      const result = await sendEmail({
        subject: built.subject, html: built.html, to, cc, bcc,
        messageId: `crm-${stamp}-${block.id.slice(-6)}`,
      });
      await record(built.subject, to, result);
      await new Promise((r) => setTimeout(r, 400));
    }
  } else {
    /**
     * The three management reports. They differ only in what they build and
     * what the attachment is called, so they share one recipient-resolution and
     * one send — three copies of this block would drift the first time one was
     * fixed.
     *
     * Feedback summary and College-wise count every follow-up in the window
     * whoever logged it when the rule is org-wide, exactly as the Reports page
     * does; a TL-scoped rule narrows to that TL's agents. `scopeFor` returns the
     * agent scope, so an unscoped rule passes `{}` to mean everyone.
     */
    const wholeOrg = !rule.scopeTlId;
    const breakdownScope = wholeOrg ? {} : scopeFor(rule);

    const built =
      rule.reportType === 'FEEDBACK_SUMMARY'
        ? await buildFeedbackSummaryEmail(db, breakdownScope, rule.frequency, now)
        : rule.reportType === 'COLLEGE_WISE'
          ? await buildCollegeWiseEmail(db, breakdownScope, rule.frequency, now)
          : await buildTeamSummary(db, scopeFor(rule), rule.frequency, now);

    const csvName =
      rule.reportType === 'FEEDBACK_SUMMARY' ? 'feedback_summary'
        : rule.reportType === 'COLLEGE_WISE' ? 'college_wise'
          : 'team_performance';

    let to: EmailAddress[] = [];
    if (rule.audience === 'FIXED') to = addressesFrom(rule.toEmails);
    else if (rule.audience === 'BY_ROLE') to = await addressesForRoles(db, rule.toRoles);
    else {
      // EACH_AGENT on a management summary would mail every agent the whole
      // team's numbers, which is not what anyone means by it.
      out.skipped = 'This report needs fixed addresses or roles, not "each agent"';
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
                filename: `${csvName}_${istDayKey(now)}.csv`,
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
