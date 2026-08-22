import { prisma } from '@/lib/prisma';
import { sendEmail, isEmailConfigured, cleanAddresses, EmailAddress } from '@/lib/email';
import { buildWelcomeEmail, WelcomeRecipient } from '@/lib/email-reports';

/**
 * Sends a new joiner their login details, and records the attempt.
 *
 * Fire-and-forget by design: creating a user must not fail because a mail
 * provider is having a bad minute. Everything lands in `EmailLog`, so a failure
 * is visible on Email Automation and can be re-sent from there.
 *
 * If an active WELCOME rule exists its Cc and Bcc are honoured, which is how an
 * admin arranges for a manager to be copied on every new account without any of
 * this being hardcoded.
 */
export async function sendWelcomeEmail(user: WelcomeRecipient): Promise<void> {
  if (!isEmailConfigured()) return;

  try {
    const rule = await prisma.emailRule.findFirst({
      where: { reportType: 'WELCOME', isActive: true },
      orderBy: { createdAt: 'asc' },
    });

    const asAddresses = (v: unknown): EmailAddress[] =>
      Array.isArray(v)
        ? cleanAddresses(
            v.flatMap((x) =>
              x && typeof x === 'object' && typeof (x as { emailid?: unknown }).emailid === 'string'
                ? [{ emailid: (x as { emailid: string }).emailid, name: (x as { name?: string }).name }]
                : [],
            ),
          )
        : [];

    const cc = asAddresses(rule?.ccEmails);
    const bcc = asAddresses(rule?.bccEmails);

    const built = buildWelcomeEmail(user);
    const to: EmailAddress[] = [{ emailid: user.email, name: user.name }];
    const result = await sendEmail({
      subject: built.subject,
      html: built.html,
      to,
      cc,
      bcc,
      messageId: `crm-welcome-${Date.now()}-${user.employeeCode ?? 'new'}`,
    });

    await prisma.emailLog.create({
      data: {
        ruleId: rule?.id ?? null,
        reportType: 'WELCOME',
        periodLabel: 'Welcome',
        subject: built.subject,
        toEmails: [user.email],
        ccEmails: cc.map((a) => a.emailid),
        bccEmails: bcc.map((a) => a.emailid),
        success: result.success,
        providerGuid: result.guid ?? null,
        providerResponse: (result.raw ?? null) as never,
        error: result.error ?? null,
      },
    });
  } catch (err) {
    // Never surface to the caller — the account was created successfully.
    console.error('[welcome-email] could not send:', err);
  }
}
