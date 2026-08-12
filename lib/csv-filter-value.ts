// Multi-select lead filters (city, college, campaign, ...) are joined into a
// single comma-separated query-string value on the client and split back
// apart on the server. That breaks the moment a single value contains a
// literal comma — college names are very often formatted "College Name,
// City" (e.g. "ICFAI Business School (IBS), Hyderabad"), which is then
// indistinguishable from the join separator: splitting "…(IBS), Hyderabad"
// yields ["…(IBS)", "Hyderabad"], neither of which matches the real value,
// so the filter silently returns zero leads.
//
// U+001F, the ASCII "unit separator" (historically designed for exactly this
// purpose), stands in for a literal comma while values are joined, and is
// restored when they're split back apart. It never appears in real lead
// data and round-trips transparently through URLSearchParams/query strings,
// so this is safe to apply unconditionally — a value with no comma in it is
// unaffected either way. Built via fromCharCode rather than a string-literal
// escape so the source file never has to carry a raw control byte.
const ESCAPED_COMMA = String.fromCharCode(31);

/** Inverse of parseCsvFilterValues() — escapes literal commas in each value
 *  before joining, so a value like "Name, City" survives the round trip. */
export function joinCsvFilterValues(values: string[]): string {
  return values.map((v) => v.split(',').join(ESCAPED_COMMA)).join(',');
}

/** Splits a comma-joined filter value back into its parts, restoring any
 *  comma that was escaped by joinCsvFilterValues(). */
export function parseCsvFilterValues(v: string | undefined | null): string[] {
  if (!v) return [];
  return v.split(',').map((s) => s.split(ESCAPED_COMMA).join(',').trim()).filter(Boolean);
}
