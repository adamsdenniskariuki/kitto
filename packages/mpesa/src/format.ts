/**
 * Pure helpers for Safaricom's Daraja M-Pesa Express (STK push) API. No I/O
 * and no secrets, so every rule is unit tested. Network calls live in
 * ./daraja.ts.
 */
import { z } from 'zod';

/** Daraja timestamps are "YYYYMMDDHHmmss" in Kenyan time, whatever zone the server runs in. */
export function darajaTimestamp(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

/** The STK push Password: base64(Shortcode + Passkey + Timestamp). */
export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

/** AccountReference allows 12 characters, TransactionDesc 13; letters, digits and spaces only. */
export function darajaText(text: string, max: number): string {
  return text.replace(/[^A-Za-z0-9 ]/g, '').slice(0, max) || 'Kitto';
}

/** Daraja amounts are whole shillings; Kitto stores cents. */
export function minorToShillings(minor: number): number {
  if (!Number.isSafeInteger(minor) || minor < 100 || minor % 100 !== 0) {
    throw new RangeError(`M-Pesa needs whole shillings, got ${minor} cents`);
  }
  return minor / 100;
}

// ---------------------------------------------------------- the callback body

const metadataItem = z.object({
  Name: z.string().max(100),
  // Numbers (Amount, PhoneNumber, TransactionDate) or strings (receipt); Balance has none.
  Value: z.union([z.number(), z.string().max(200)]).optional(),
});

/**
 * Shape check before anything reaches the database. `.loose()` keeps unknown
 * keys: the raw payload is stored for audit and Safaricom adds fields.
 */
export const stkCallbackSchema = z.object({
  Body: z.object({
    stkCallback: z
      .object({
        MerchantRequestID: z.string().min(1).max(100),
        CheckoutRequestID: z.string().min(1).max(100),
        ResultCode: z.number().int(),
        ResultDesc: z.string().max(500),
        CallbackMetadata: z.object({ Item: z.array(metadataItem).max(20) }).optional(),
      })
      .loose(),
  }),
});

export type StkCallback = z.infer<typeof stkCallbackSchema>;

/** A callback exactly like Safaricom's, for mock mode and tests. */
export function buildStkCallback(input: {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: number;
  amountKes?: number;
  phone?: string;
  receipt?: string;
  at?: Date;
}): StkCallback {
  const success = input.resultCode === 0;
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: input.merchantRequestId,
        CheckoutRequestID: input.checkoutRequestId,
        ResultCode: input.resultCode,
        ResultDesc: success
          ? 'The service request is processed successfully.'
          : input.resultCode === 1032
            ? 'Request cancelled by user'
            : 'The balance is insufficient for the transaction.',
        ...(success && {
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: input.amountKes ?? 1 },
              { Name: 'MpesaReceiptNumber', Value: input.receipt ?? 'KTOMOCK000' },
              { Name: 'TransactionDate', Value: Number(darajaTimestamp(input.at)) },
              { Name: 'PhoneNumber', Value: Number(input.phone ?? '254708374149') },
            ],
          },
        }),
      },
    },
  };
}

/**
 * Mock mode picks the outcome from the phone number, so demos and tests can
 * choose: ending 1032 -> the customer cancels; ending 0001 -> insufficient
 * funds (1); anything else -> paid.
 */
export function mockResultCode(darajaPhone: string): number {
  if (darajaPhone.endsWith('1032')) return 1032;
  if (darajaPhone.endsWith('0001')) return 1;
  return 0;
}

/** A plausible receipt such as "KTO4K9Q2ZA" (10 upper-case characters). */
export function mockReceipt(random: () => number = Math.random): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'KTO';
  for (let i = 0; i < 7; i++) out += chars[Math.floor(random() * chars.length)];
  return out;
}

export const MPESA_STATUSES = [
  'pending',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'needs_review',
] as const;
export type MpesaStatus = (typeof MPESA_STATUSES)[number];

/** Words for staff, per request status. */
export function resultMessage(status: string, resultDesc?: string | null): string {
  switch (status) {
    case 'succeeded':
      return 'Paid';
    case 'pending':
      return 'Waiting for the customer to enter their M-Pesa PIN';
    case 'cancelled':
      return 'The customer cancelled the prompt';
    case 'expired':
      return 'No answer from the customer';
    case 'needs_review':
      return 'Paid, but could not be applied automatically. Check and record it by hand.';
    default:
      return resultDesc ? `Not paid: ${resultDesc}` : 'Not paid';
  }
}
