// Renders a Lead Integration's JSON body template — a literal JSON string
// authored by an admin, containing {{field}} or {{helper(field)}} tokens
// that sit inside quoted JSON string values (e.g. "name": "{{name}}"). This
// file is isomorphic (no server-only imports) so the exact same rendering
// logic drives both the client-side Live Preview and the real server-side
// send in lib/lead-integration-engine.ts — what an admin previews is
// guaranteed to be what actually gets sent.
//
// Deliberately NOT eval()/new Function()-based: a stored, admin-authored
// template must never become arbitrary code execution. Only a small fixed
// set of helpers is supported.

const TOKEN_REGEX = /\{\{\s*([^}]+?)\s*\}\}/g;
const HELPER_CALL_REGEX = /^(\w+)\(\s*([\w.]+)\s*(?:,\s*"([^"]*)")?\)$/;

export interface HelperDoc {
  syntax: string;
  description: string;
}

export const TEMPLATE_HELPERS: HelperDoc[] = [
  { syntax: '{{field}}', description: 'Inserts the field value as-is.' },
  { syntax: '{{upper(field)}}', description: 'Inserts the field value in UPPERCASE.' },
  { syntax: '{{lower(field)}}', description: 'Inserts the field value in lowercase.' },
  { syntax: '{{digits(field)}}', description: 'Keeps only the digits — turns an employee code like EMP-1005 into 1005.' },
  { syntax: '{{join(field)}}', description: 'Joins a list field (e.g. Preferred Cities) into a comma-separated string.' },
  { syntax: '{{default(field, "fallback")}}', description: 'Uses "fallback" when the field is empty/missing.' },
];

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  return String(value);
}

/**
 * The one implementation of the helper set.
 *
 * Both renderers below route through this: the JSON body and a header/URL must
 * support exactly the same helpers, and keeping two copies in step by hand is
 * how a helper ends up working in one place and silently emitting an empty
 * string in the other.
 *
 * Unknown helper names fail closed to '' rather than leaking the literal token
 * text into the output.
 */
function applyHelper(
  helperName: string,
  raw: unknown,
  fallback: string | undefined,
): string {
  switch (helperName) {
    case 'upper':
      return toDisplayString(raw).toUpperCase();
    case 'lower':
      return toDisplayString(raw).toLowerCase();
    // Non-digits are dropped wholesale, so a receiving system that wants a bare
    // numeric id can take one straight from a prefixed code.
    case 'digits':
      return toDisplayString(raw).replace(/\D+/g, '');
    case 'join':
      return toDisplayString(raw);
    case 'default':
      return toDisplayString(raw) || (fallback ?? '');
    default:
      return '';
  }
}

/** Resolves one token to its final text, helper or plain field alike. */
function tokenValue(tokenRaw: string, data: Record<string, unknown>): string {
  const token = tokenRaw.trim();
  const helperMatch = token.match(HELPER_CALL_REGEX);
  if (helperMatch) {
    const [, helperName, fieldKey, fallback] = helperMatch;
    return applyHelper(helperName, data[fieldKey], fallback);
  }
  // Plain {{field}} reference (only bare word/underscore field names are valid).
  return /^[\w.]+$/.test(token) ? toDisplayString(data[token]) : '';
}

function resolveToken(tokenRaw: string, data: Record<string, unknown>): string {
  // The token sits inside a JSON string literal already opened/closed by the
  // template itself, so escape for JSON-string-safety without adding
  // surrounding quotes of our own.
  return JSON.stringify(tokenValue(tokenRaw, data)).slice(1, -1);
}

export interface RenderResult {
  output: string;
  valid: boolean;
  error?: string;
  fieldsUsed: number;
}

export function renderTemplate(template: string, data: Record<string, unknown>): RenderResult {
  let fieldsUsed = 0;
  const output = template.replace(TOKEN_REGEX, (_match, tokenRaw: string) => {
    fieldsUsed += 1;
    return resolveToken(tokenRaw, data);
  });

  try {
    JSON.parse(output);
    return { output, valid: true, fieldsUsed };
  } catch (err) {
    return { output, valid: false, error: err instanceof Error ? err.message : 'Invalid JSON', fieldsUsed };
  }
}

/** Same substitution, for plain-text values like a header or a URL/query-param — no JSON validation. */
export function renderText(template: string, data: Record<string, unknown>): string {
  return template.replace(TOKEN_REGEX, (_match, tokenRaw: string) => tokenValue(tokenRaw, data));
}
