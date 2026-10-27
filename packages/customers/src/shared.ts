import { commonErrorCode, KittoError } from '@kitto/core';
import type { ZodError } from 'zod';
import { CUSTOMER_PERMISSIONS } from './permissions';

/** ?notice= codes shown after customer actions. */
export const CUSTOMER_NOTICES = {
  created: 'Customer added.',
  saved: 'Customer saved.',
  archived: 'Customer archived. They are hidden from lists but keep their history.',
  restored: 'Customer restored.',
  deleted: 'Customer deleted.',
  note_added: 'Note added.',
  note_deleted: 'Note deleted.',
} as const;

/** ?error= codes on top of COMMON_ERRORS. */
export const CUSTOMER_ERRORS = {
  invalid_name: 'Enter a name of up to 120 characters.',
  invalid_phone: 'Enter a valid phone number, e.g. 0712 345 678 or +254712345678.',
  invalid_email: 'Enter a valid email address.',
  invalid_tags: 'Use at most 20 tags, each under 40 characters.',
  invalid_note: 'Write a note of up to 2,000 characters.',
  phone_taken: 'Another customer already has that phone number.',
  in_use: 'This customer has history (bookings, orders or invoices), so archive them instead.',
} as const;

export type CustomerErrorCode = keyof typeof CUSTOMER_ERRORS;

/** The first invalid field of a customer form, as an error code. */
export function customerFormError(error: ZodError): CustomerErrorCode | 'invalid' {
  const field = error.issues[0]?.path[0];
  switch (field) {
    case 'name':
      return 'invalid_name';
    case 'phone':
      return 'invalid_phone';
    case 'email':
      return 'invalid_email';
    case 'tags':
      return 'invalid_tags';
    case 'body':
      return 'invalid_note';
    default:
      return 'invalid';
  }
}

/** Classify database errors from customer actions. */
export function customerErrorCode(e: unknown): string {
  if (e instanceof KittoError) {
    if (e.isConflict && /phone/i.test(e.message)) return 'phone_taken';
    if (e.code === '22023' && /phone/i.test(e.message)) return 'invalid_phone';
  }
  return commonErrorCode(e);
}

/** Nav entry for apps that include the customers module. */
export function customersNav(ctx: { can: (p: string) => boolean; path: (p?: string) => string }) {
  return ctx.can(CUSTOMER_PERMISSIONS.view)
    ? [{ href: ctx.path('/customers'), label: 'Customers' }]
    : [];
}
