// Placeholder value the edit UI sends back for a secret header/param field
// the admin didn't touch, so the server knows to keep the existing
// encrypted value rather than encrypting the literal placeholder text.
// Split into its own file (no node built-ins) so client components can
// import it without pulling lib/integration-crypto.ts's `crypto` usage
// into the browser bundle.
export const SECRET_UNCHANGED_SENTINEL = '__SECRET_UNCHANGED__';
