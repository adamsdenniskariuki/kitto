import { z } from 'zod';
import { percentToBp, quantityHundredths } from './math';
import { DOCUMENT_KINDS, PAYMENT_METHODS } from './status';

/** A money amount as typed: "4500", "4,500.50". Stays in major units; actions convert per currency. */
const majorAmount = (message: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ''))
    .pipe(z.string().regex(/^\d{1,12}(\.\d{1,3})?$/, message))
    .transform(Number);

const optionalUuid = z.union([z.literal('').transform(() => null), z.uuid()]);

/** One line as typed into the editor. `unitPrice` is in major units. */
export const lineFormSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, 'Describe the line')
    .max(500, 'Keep the description under 500 characters'),
  quantity: z
    .string()
    .trim()
    .refine((v) => {
      const q = quantityHundredths(v);
      return q !== null && q > 0n && q < 10n ** 12n;
    }, 'Quantity is a number above zero with at most two decimals')
    .transform(Number),
  unitPrice: majorAmount('Enter a price like 4500 or 4500.50'),
  taxRateBp: z
    .string()
    .trim()
    .transform((v, c) => {
      const bp = percentToBp(v);
      if (bp === null) {
        c.addIssue({ code: 'custom', message: 'Tax is a percentage from 0 to 100' });
        return z.NEVER;
      }
      return bp;
    }),
});
export type LineFormInput = z.output<typeof lineFormSchema>;

/** A draft quote or invoice as typed into the form. */
export const invoiceFormSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  customerId: optionalUuid,
  dueDate: z.union([
    z.literal('').transform(() => null),
    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date'),
  ]),
  notes: z.string().trim().max(2000, 'Keep notes under 2,000 characters'),
  lines: z
    .array(lineFormSchema)
    .min(1, 'Add at least one line')
    .max(100, 'A document can have at most 100 lines'),
});
export type InvoiceFormInput = z.output<typeof invoiceFormSchema>;

export interface RawLine {
  description: string;
  quantity: string;
  unitPrice: string;
  taxRate: string;
}

/**
 * The line editor posts repeated fields (lineDescription, lineQuantity, ...).
 * Zip them into rows, dropping rows left completely blank.
 */
export function linesFromForm(fd: FormData): RawLine[] {
  const all = (k: string) => fd.getAll(k).map((v) => (typeof v === 'string' ? v : ''));
  const d = all('lineDescription');
  const q = all('lineQuantity');
  const p = all('linePrice');
  const t = all('lineTax');
  const rows: RawLine[] = [];
  for (let i = 0; i < Math.max(d.length, q.length, p.length, t.length); i++) {
    const row = {
      description: d[i] ?? '',
      quantity: q[i] ?? '',
      unitPrice: p[i] ?? '',
      taxRate: t[i] ?? '',
    };
    if (row.description.trim() || row.unitPrice.trim()) rows.push(row);
  }
  return rows;
}

/** Raw rows -> what lineFormSchema parses (blank quantity means 1). */
export const toLineInput = (r: RawLine) => ({
  description: r.description,
  quantity: r.quantity.trim() || '1',
  unitPrice: r.unitPrice,
  taxRateBp: r.taxRate,
});

export const paymentFormSchema = z.object({
  amount: majorAmount('Enter an amount like 1500').refine(
    (v) => v > 0,
    'Enter an amount above zero',
  ),
  method: z.enum(PAYMENT_METHODS),
  reference: z
    .string()
    .trim()
    .max(100, 'Keep the reference under 100 characters')
    .transform((v) => v || null),
  note: z.string().trim().max(500, 'Keep the note under 500 characters'),
});
export type PaymentFormInput = z.output<typeof paymentFormSchema>;

export const voidFormSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Give a reason')
    .max(500, 'Keep the reason under 500 characters'),
});

/** A generic source a module bills, e.g. { type: 'reservation', id }. */
export const sourceSchema = z.object({
  type: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  id: z.uuid(),
});
export type BillingSource = z.output<typeof sourceSchema>;
