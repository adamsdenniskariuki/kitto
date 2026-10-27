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

// ------------------------------------------------------- action outcomes

/**
 * Error codes shared by every module's Server Actions. Pages receive codes in
 * the query string (?error=in_use), never raw text, so nobody can craft a link
 * that shows arbitrary messages. Modules add their own codes alongside these.
 */
export const COMMON_ERRORS = {
  invalid: 'Please check the form and try again.',
  forbidden: "You don't have permission to do that.",
  exists: 'That already exists.',
  in_use: 'That is still used elsewhere, so it cannot be deleted. Archive it instead.',
  conflict: 'That clashes with something that already exists.',
  not_found: 'That record no longer exists.',
  failed: 'Something went wrong. Please try again.',
} as const;
export type CommonErrorCode = keyof typeof COMMON_ERRORS;

/** Classify any error thrown by a data-access helper into a CommonErrorCode. */
export function commonErrorCode(e: unknown): CommonErrorCode {
  if (!(e instanceof KittoError)) return 'failed';
  if (e.isPermissionDenied) return 'forbidden';
  if (e.isConflict) return 'exists';
  if (e.code === '23503') return 'in_use';
  if (e.code === '23P01') return 'conflict';
  if (e.isNotFound) return 'not_found';
  if (['22023', '23514', '22P02', '22007', '22008'].includes(e.code ?? '')) return 'invalid';
  return 'failed';
}

type Params = Record<string, string | string[] | undefined>;

/** Turn ?notice= / ?error= codes into display text; unknown codes are ignored. */
export function flashMessages(
  searchParams: Params | undefined,
  notices: Record<string, string>,
  errors: Record<string, string> = COMMON_ERRORS,
): { notice?: string; error?: string } {
  const n = searchParams?.notice;
  const e = searchParams?.error;
  const all: Record<string, string> = { ...COMMON_ERRORS, ...errors };
  return {
    ...(typeof n === 'string' && Object.hasOwn(notices, n) ? { notice: notices[n]! } : {}),
    ...(typeof e === 'string' && Object.hasOwn(all, e) ? { error: all[e]! } : {}),
  };
}

/** "path?key=value&...": keeps any query string already on `path`. */
export function withQuery(path: string, params: Record<string, string | undefined>): string {
  const [base, existing = ''] = path.split('?', 2) as [string, string?];
  const qs = new URLSearchParams(existing);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, v);
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}
