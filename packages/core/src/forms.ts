import type { z } from 'zod';
import { KittoError } from './data';

/**
 * Result of a form Server Action, used with React's useActionState.
 * `values` echoes what the user typed, because React resets the form after
 * an action runs.
 */
export type FormState =
  | { status: 'idle' }
  | { status: 'success'; message?: string; values?: Record<string, string> }
  | { status: 'error'; errors: Record<string, string>; values?: Record<string, string> };

export const IDLE: FormState = { status: 'idle' };

/** First error message per field; form-level errors go under "_form". */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? issue.path.join('.') : '_form';
    out[key] ??= issue.message;
  }
  return out;
}

/** String values of a FormData (files are skipped), for echoing back into a form. */
export function formValues(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === 'string' && !k.startsWith('$ACTION')) out[k] = v;
  }
  return out;
}

/**
 * A safe, user-facing message for an error thrown by a data-access helper.
 * Messages raised deliberately by Kitto SQL (RAISE ... USING ERRCODE) are
 * written for end users; anything unexpected becomes a generic message.
 */
export function userMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (error instanceof KittoError) {
    if (error.isPermissionDenied) {
      return /permission denied for|row-level security/i.test(error.message)
        ? "You don't have permission to do that."
        : error.message;
    }
    if (['23505', '23514', 'P0002', '22023', '23P01', 'P0001'].includes(error.code ?? '')) {
      // Raw constraint messages mention table internals; Kitto's own RAISEs don't.
      if (/duplicate key/i.test(error.message)) return 'That already exists.';
      if (/violates|relation "/i.test(error.message)) return 'That change is not allowed.';
      return error.message;
    }
  }
  return fallback;
}
