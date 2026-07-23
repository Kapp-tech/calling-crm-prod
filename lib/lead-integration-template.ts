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
  { syntax: '{{join(field)}}', description: 'Joins a list field (e.g. Preferred Cities) into a comma-separated string.' },
  { syntax: '{{default(field, "fallback")}}', description: 'Uses "fallback" when the field is empty/missing.' },
];

function toDisplayString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  return String(value);
}

function resolveToken(tokenRaw: string, data: Record<string, unknown>): string {
  const token = tokenRaw.trim();
  const helperMatch = token.match(HELPER_CALL_REGEX);

  let display: string;
  if (helperMatch) {
    const [, helperName, fieldKey, fallback] = helperMatch;
    const raw = data[fieldKey];
    switch (helperName) {
      case 'upper':
        display = toDisplayString(raw).toUpperCase();
        break;
      case 'lower':
        display = toDisplayString(raw).toLowerCase();
        break;
      case 'join':
        display = toDisplayString(raw);
        break;
      case 'default':
        display = toDisplayString(raw) || (fallback ?? '');
        break;
      default:
        // Unknown helper name — fail closed to an empty string rather than
        // silently emitting the literal token text into the JSON body.
        display = '';
    }
  } else {
    // Plain {{field}} reference (only bare word/underscore field names are valid).
    display = /^[\w.]+$/.test(token) ? toDisplayString(data[token]) : '';
  }

  // The token sits inside a JSON string literal already opened/closed by the
  // template itself, so escape for JSON-string-safety without adding
  // surrounding quotes of our own.
  return JSON.stringify(display).slice(1, -1);
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
  return template.replace(TOKEN_REGEX, (_match, tokenRaw: string) => {
    const token = tokenRaw.trim();
    const helperMatch = token.match(HELPER_CALL_REGEX);
    if (helperMatch) {
      const [, helperName, fieldKey, fallback] = helperMatch;
      const raw = data[fieldKey];
      if (helperName === 'upper') return toDisplayString(raw).toUpperCase();
      if (helperName === 'lower') return toDisplayString(raw).toLowerCase();
      if (helperName === 'join') return toDisplayString(raw);
      if (helperName === 'default') return toDisplayString(raw) || (fallback ?? '');
      return '';
    }
    return /^[\w.]+$/.test(token) ? toDisplayString(data[token]) : '';
  });
}
