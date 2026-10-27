import { KittoError } from '@kitto/core';
import { billingErrorCode } from '@kitto/billing/shared';

export const MPESA_NOTICES = {
  mpesa_sent: 'Payment request sent. Ask the customer to enter their M-Pesa PIN.',
} as const;

export const MPESA_ERRORS = {
  phone: 'Enter a Kenyan mobile number, e.g. 0712 345 678.',
  mpesa_amount: 'M-Pesa amounts are whole shillings between 1 and 250,000.',
  currency: 'M-Pesa can only collect invoices in KES.',
  pending: 'A request is already waiting on the customer’s phone. Wait a minute and refresh.',
  rate_limited: 'Too many requests for this invoice. Try again later.',
  mpesa_disabled: 'M-Pesa is not set up for this app.',
  mpesa_rejected: 'M-Pesa did not accept the request. Check the number and try again.',
} as const;

const MESSAGES: [RegExp, keyof typeof MPESA_ERRORS][] = [
  [/must be in KES/i, 'currency'],
  [/invalid M-Pesa phone/i, 'phone'],
  [/whole shillings/i, 'mpesa_amount'],
];

/** Classify an error from an M-Pesa action. Falls back to the billing and common codes. */
export function mpesaErrorCode(e: unknown): string {
  if (e instanceof KittoError) {
    if (e.code === 'mpesa_disabled' || e.code === 'mpesa_rejected') return e.code;
    if (e.code === '55000') return 'pending';
    if (e.code === '54000') return 'rate_limited';
    if (e.code === '22023') {
      for (const [pattern, code] of MESSAGES) if (pattern.test(e.message)) return code;
    }
  }
  return billingErrorCode(e);
}

/** For InvoiceDetailPage's `messages` prop. */
export const MPESA_MESSAGES = { notices: MPESA_NOTICES, errors: MPESA_ERRORS };
