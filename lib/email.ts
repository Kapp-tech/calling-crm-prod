/**
 * Server-only client for the GoInfinito Unified email API.
 *
 * Credentials live in the environment and must never reach the browser or the
 * database — the UI configures *who* gets mail, never how mail is sent.
 */

const SEND_URL = 'https://api.goinfinito.com/unified/v2/send';

// Mail is queued upstream, not delivered synchronously, so this only bounds how
// long we wait for the provider to accept it.
const FETCH_TIMEOUT_MS = 20_000;

export interface EmailAddress {
  emailid: string;
  name?: string | null;
}

export interface EmailAttachment {
  /** Base64, without a data: prefix. */
  content: string;
  filename: string;
  type: string;
}

export interface SendEmailInput {
  subject: string;
  html: string;
  to: EmailAddress[];
  cc?: EmailAddress[];
  bcc?: EmailAddress[];
  attachments?: EmailAttachment[];
  /** Our own id for the message, echoed back by the provider. */
  messageId: string;
}

export interface SendEmailResult {
  success: boolean;
  /** The provider's tracking id, for chasing one message with their support. */
  guid?: string;
  error?: string;
  raw?: unknown;
}

export function isEmailConfigured(): boolean {
  return Boolean(
    process.env.GOINFINITO_CLIENT_ID &&
      process.env.GOINFINITO_CLIENT_PASSWORD &&
      process.env.EMAIL_FROM_ADDRESS,
  );
}

/** Trims and drops anything that is not a usable address. */
export function cleanAddresses(list: EmailAddress[] | undefined): EmailAddress[] {
  const seen = new Set<string>();
  return (list ?? [])
    .map((a) => ({ emailid: (a.emailid ?? '').trim(), name: a.name?.trim() || undefined }))
    .filter((a) => {
      const key = a.emailid.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.emailid) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Sends one message.
 *
 * **The provider answers HTTP 200 on failure.** A rejected payload comes back as
 * `200` with `{"status":"Error","statuscode":65537}`, so the body's `status` is
 * the only honest signal — checking the status code would record every failed
 * send as delivered. Never let this collapse into `res.ok`.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const clientId = process.env.GOINFINITO_CLIENT_ID;
  const password = process.env.GOINFINITO_CLIENT_PASSWORD;
  const fromAddress = process.env.EMAIL_FROM_ADDRESS;
  const fromName = process.env.EMAIL_FROM_NAME ?? 'KollegeApply CRM';
  const replyTo = process.env.EMAIL_REPLY_TO ?? fromAddress;

  if (!clientId || !password || !fromAddress) {
    return { success: false, error: 'Email is not configured on this server' };
  }

  const to = cleanAddresses(input.to);
  if (to.length === 0) return { success: false, error: 'No valid recipient address' };
  const cc = cleanAddresses(input.cc);
  const bcc = cleanAddresses(input.bcc);

  const body = {
    apiver: '1.0',
    email: {
      ver: '1.0',
      messages: [
        {
          id: input.messageId,
          from: { emailid: fromAddress, name: fromName },
          reply_to: { emailid: replyTo, name: fromName },
          category: 'Transactional',
          content: [{ type: 'text/html', value: input.html }],
          addresses: [
            {
              subject: input.subject,
              address_seq_id: input.messageId,
              to,
              ...(cc.length ? { cc } : {}),
              ...(bcc.length ? { bcc } : {}),
              ...(input.attachments?.length
                ? {
                    attachments: input.attachments.map((a) => ({
                      content: a.content,
                      filename: a.filename,
                      type: a.type,
                      disposition: 'attachment',
                    })),
                  }
                : {}),
            },
          ],
        },
      ],
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: {
        'x-client-id': clientId,
        'x-client-password': password,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    });

    const json = (await res.json().catch(() => null)) as
      | {
          status?: string;
          statuscode?: number;
          statustext?: string;
          messageack?: { guids?: { guid?: string; id?: string }[] };
        }
      | null;

    if (json?.status === 'Success') {
      return { success: true, guid: json.messageack?.guids?.[0]?.guid, raw: json };
    }
    return {
      success: false,
      error: json?.statustext
        ? `${json.statustext} (code ${json.statuscode ?? '?'})`
        : `Provider returned HTTP ${res.status}`,
      raw: json,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, error: `Timed out after ${FETCH_TIMEOUT_MS / 1000}s` };
    }
    return { success: false, error: err instanceof Error ? err.message : 'Send failed' };
  } finally {
    clearTimeout(timeout);
  }
}
