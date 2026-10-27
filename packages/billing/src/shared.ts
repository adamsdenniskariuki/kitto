import { commonErrorCode, KittoError } from '@kitto/core';
import { BILLING_PERMISSIONS as P } from './permissions';

export const BILLING_NOTICES = {
  created: 'Draft saved.',
  saved: 'Draft saved.',
  issued: 'Issued and numbered.',
  voided: 'Voided. The number stays used.',
  converted: 'Quote accepted. Review the new invoice and issue it.',
  deleted: 'Draft deleted.',
  payment_recorded: 'Payment recorded.',
  source_invoiced: 'Invoice ready. Review it and issue it.',
} as const;

export const BILLING_ERRORS = {
  locked: 'Only drafts can be changed. Void it and start again if it is wrong.',
  not_draft: 'This has already been issued.',
  no_lines: 'Add at least one line.',
  too_many_lines: 'A document can have at most 100 lines.',
  zero_total: 'The total must be above zero to issue.',
  cannot_void: 'Only issued documents without payments can be voided.',
  void_reason: 'Give a reason for voiding.',
  cannot_convert: 'Only sent quotes can be accepted.',
  not_payable: 'Payments can only be recorded against issued, unpaid invoices.',
  overpayment: 'That is more than the balance due.',
  invalid_lines: 'Check the lines: each needs a description, a quantity above zero and a price.',
  invalid_payment: 'Check the payment: enter an amount above zero.',
  not_found: 'That document no longer exists.',
} as const;

const MESSAGES: [RegExp, keyof typeof BILLING_ERRORS][] = [
  [/only drafts can be edited/i, 'locked'],
  [/only drafts can be issued/i, 'not_draft'],
  [/at least one line/i, 'no_lines'],
  [/at most 100 lines/i, 'too_many_lines'],
  [/above zero to issue/i, 'zero_total'],
  [/can be voided/i, 'cannot_void'],
  [/reason is required/i, 'void_reason'],
  [/quotes can be converted/i, 'cannot_convert'],
  [/issued, unpaid invoices/i, 'not_payable'],
  [/exceeds the balance/i, 'overpayment'],
];

/** Classify a database error from a billing action. Never shows database text. */
export function billingErrorCode(e: unknown): string {
  if (e instanceof KittoError && e.code === '22023') {
    for (const [pattern, code] of MESSAGES) if (pattern.test(e.message)) return code;
  }
  return commonErrorCode(e);
}

/** Nav entries for apps that include the billing module. */
export function billingNav(ctx: { can: (p: string) => boolean; path: (p?: string) => string }) {
  return ctx.can(P.view) ? [{ href: ctx.path('/invoices'), label: 'Invoices' }] : [];
}
