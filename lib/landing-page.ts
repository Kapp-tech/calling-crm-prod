/**
 * College landing-page links.
 *
 * A college gives us one application URL that every counsellor shares with
 * students. The college needs to know *which* counsellor sent each applicant,
 * so the URL carries a per-agent marker in its `utm_medium`:
 *
 *   https://application.example.edu/?utm_source=kollege_apply&utm_medium=kcll_{{%agent%}}&utm_campaign=2027
 *
 * The admin stores that string once, with the token still in it, and the token
 * is replaced with the reading agent's ID when the page renders. Nothing
 * per-agent is stored — one row serves the whole floor, and a new joiner's
 * links work the moment their account exists.
 */

/** The literal token an admin types into the stored URL. */
export const AGENT_TOKEN = '{{%agent%}}';

/**
 * Tolerant of stray spaces (`{{ %agent% }}`) and of case, because this is typed
 * by hand into a text box and a near-miss would otherwise ship a broken link to
 * the college with the raw token still in the query string.
 */
const AGENT_TOKEN_RE = /\{\{\s*%\s*agent\s*%\s*\}\}/gi;

export function hasAgentToken(url: string): boolean {
  // .test() with a /g regex is stateful via lastIndex; a fresh regex each call
  // avoids the every-other-call-returns-false bug that comes with sharing one.
  return new RegExp(AGENT_TOKEN_RE.source, 'i').test(url);
}

/**
 * The agent's ID as the colleges see it: the digits of the employee code, so
 * `EMP-019` is sent as `019`.
 *
 * Deliberately the same rule as the `digits()` helper in Lead Integrations,
 * which is what already populates `counsellor_id` when we push a lead — an
 * agent's identifier must not mean two different things depending on which
 * system is looking at it.
 *
 * Leading zeros are preserved: `019` and `19` are different agents to the
 * college, and Number() would quietly merge them.
 */
export function agentTagFor(employeeCode: string | null | undefined): string | null {
  const digits = (employeeCode ?? '').replace(/\D+/g, '');
  return digits || null;
}

/**
 * Fills the token in. Returns the URL unchanged when it carries no token —
 * some colleges track by campaign only, and that is a valid link, not an error.
 */
export function resolveLandingPageUrl(template: string, agentTag: string | null): string {
  if (!agentTag) return template;
  return template.replace(new RegExp(AGENT_TOKEN_RE.source, 'gi'), agentTag);
}

const MAX_URL_LENGTH = 1000;

export interface UrlCheck {
  ok: boolean;
  error?: string;
}

/**
 * Validates what an admin typed before it is stored.
 *
 * The check runs against the *resolved* URL, not the template: `{{%agent%}}`
 * contains `%a`, which is an invalid percent-escape, and some strict consumers
 * reject it. Substituting a sample first means we validate the shape of the
 * link a student will actually receive.
 */
export function checkLandingPageUrl(raw: string): UrlCheck {
  const value = raw.trim();
  if (!value) return { ok: true }; // blank clears the field

  if (value.length > MAX_URL_LENGTH) {
    return { ok: false, error: `Link is too long (max ${MAX_URL_LENGTH} characters)` };
  }

  let parsed: URL;
  try {
    parsed = new URL(resolveLandingPageUrl(value, '000'));
  } catch {
    return { ok: false, error: 'That is not a valid link. It should start with https://' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, error: 'The link must start with https:// or http://' };
  }

  // A stray `{{...}}` that is not the agent token would be handed to the
  // student verbatim. Catch the typo here rather than in the college's logs.
  const leftover = value.replace(new RegExp(AGENT_TOKEN_RE.source, 'gi'), '');
  if (leftover.includes('{{') || leftover.includes('}}')) {
    return { ok: false, error: `The only placeholder allowed is ${AGENT_TOKEN}` };
  }

  return { ok: true };
}
