/**
 * The check-in gate, in the parts both sides need.
 *
 * No server imports: the API routes and the client dialog both read from here,
 * and importing this from anything that touches Prisma would drag PrismaClient
 * into the browser bundle.
 */

/**
 * Marks a refusal as "you have not checked in" rather than any other 403, so the
 * client can pop the check-in dialog instead of a generic error toast. A status
 * code alone would not do — a permission failure is also a 403.
 */
export const ATTENDANCE_REQUIRED_CODE = 'ATTENDANCE_REQUIRED';

export const ATTENDANCE_REQUIRED_MESSAGE =
  'Mark your attendance first. Check in to start calling and logging follow-ups.';

/** True when a failed response was refused for want of attendance. */
export function isAttendanceBlock(body: unknown): boolean {
  return !!body && typeof body === 'object' && (body as { code?: unknown }).code === ATTENDANCE_REQUIRED_CODE;
}

// ─── A one-line channel from any fetch to the dialog ─────────────────────────
//
// The dialog is mounted once in the dashboard shell; the four places that call
// or log a follow-up just announce the refusal. That beats threading dialog
// state through four unrelated components, and it means a fifth caller added
// later needs one line rather than its own copy of the UI.

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe the dialog. Returns an unsubscribe for the effect cleanup. */
export function onAttendanceRequired(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Ask the mounted dialog to open. */
export function requireCheckIn(): void {
  listeners.forEach((fn) => fn());
}

const ATTENDANCE_ERROR_NAME = 'AttendanceRequiredError';

/**
 * Call with the parsed error body of any failed request.
 *
 * When the refusal was "you have not checked in", this opens the dialog and
 * throws an error marked as already-handled. Otherwise it does nothing and the
 * caller carries on with its normal error path.
 *
 * The marker exists so the caller's onError can stay quiet: the dialog already
 * explains the problem and offers the fix, and a red "Call failed" toast beside
 * it says the same thing twice, the second time in a more alarming voice.
 */
export function failIfAttendanceBlock(body: unknown): void {
  if (!isAttendanceBlock(body)) return;
  requireCheckIn();
  const err = new Error(ATTENDANCE_REQUIRED_MESSAGE);
  err.name = ATTENDANCE_ERROR_NAME;
  throw err;
}

/** True for the error `failIfAttendanceBlock` throws — the dialog has it. */
export function isAttendanceError(e: unknown): boolean {
  return e instanceof Error && e.name === ATTENDANCE_ERROR_NAME;
}
