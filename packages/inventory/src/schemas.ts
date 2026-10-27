import { z } from 'zod';

/** Largest quantity numeric(12,3) holds. */
export const MAX_QUANTITY = 999_999_999.999;

const QUANTITY = /^-?\d{1,9}(\.\d{1,3})?$/;

/** A typed quantity ("2", "1.5", "0.250"), up to three decimals; commas are ignored. */
const quantityText = (message: string) =>
  z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, ''))
    .pipe(z.string().regex(QUANTITY, message))
    .transform(Number);

/** A quantity above zero (purchases, transfers, order lines). */
export const quantitySchema = quantityText('Enter a quantity like 2 or 1.5').pipe(
  z.number().gt(0, 'Enter a quantity above zero'),
);

/** A signed, non-zero quantity (adjustments: +5 found, -2 broken). */
export const signedQuantitySchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/^\+/, ''))
  .pipe(quantityText('Enter a quantity like 5 or -2'))
  .pipe(z.number().refine((n) => n !== 0, 'Enter a quantity other than zero'));

/** A quantity of zero or more ('' is zero), e.g. a reorder level. */
export const levelSchema = z
  .string()
  .trim()
  .transform((v) => v || '0')
  .pipe(quantityText('Enter a number like 10 or 2.5'))
  .pipe(z.number().min(0, 'Enter zero or more'));

/** A price in major units ("4,500.50"); '' means none. Actions convert with the tenant currency. */
export const optionalMoneySchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/,/g, ''))
  .pipe(
    z.union([
      z.literal('').transform(() => null),
      z
        .string()
        .regex(/^\d{1,12}(\.\d{1,3})?$/, 'Enter a price like 4500 or 4500.50')
        .transform(Number),
    ]),
  );

/** A price in major units that must be given ('' is zero). */
export const moneySchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/,/g, '') || '0')
  .pipe(z.string().regex(/^\d{1,12}(\.\d{1,3})?$/, 'Enter a price like 4500 or 4500.50'))
  .transform(Number);

const optionalText = (max: number, message: string) =>
  z
    .string()
    .trim()
    .max(max, message)
    .transform((v) => v || null);

export const itemFormSchema = z.object({
  sku: z
    .string()
    .trim()
    .transform((v) => v || null)
    .pipe(
      z
        .string()
        .regex(
          /^[A-Za-z0-9][A-Za-z0-9._/-]{0,39}$/,
          'Use up to 40 letters, numbers, dots, dashes or slashes',
        )
        .nullable(),
    ),
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Keep the name under 120 characters'),
  unit: z
    .string()
    .trim()
    .transform((v) => v || 'each')
    .pipe(z.string().max(20, 'Keep the unit under 20 characters')),
  category: z.string().trim().max(60, 'Keep the category under 60 characters'),
  description: z.string().trim().max(2000, 'Keep the description under 2,000 characters'),
  cost: optionalMoneySchema,
  price: optionalMoneySchema,
  reorderLevel: levelSchema,
  trackStock: z.boolean(),
  allowNegative: z.boolean(),
  active: z.boolean(),
});
export type ItemFormInput = z.output<typeof itemFormSchema>;

export const supplierFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Keep the name under 120 characters'),
  contactName: z.string().trim().max(120, 'Keep the contact name under 120 characters'),
  phone: optionalText(40, 'Keep the phone number under 40 characters'),
  email: z
    .string()
    .trim()
    .transform((v) => v || null)
    .pipe(z.email('Enter a valid email address').max(254).nullable()),
  notes: z.string().trim().max(2000, 'Keep notes under 2,000 characters'),
  active: z.boolean(),
});
export type SupplierFormInput = z.output<typeof supplierFormSchema>;

export const locationFormSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(80, 'Keep the name under 80 characters'),
  active: z.boolean(),
});
export type LocationFormInput = z.output<typeof locationFormSchema>;

export const purchaseFormSchema = z.object({
  supplierId: z.uuid('Choose a supplier'),
  locationId: z.uuid('Choose where it is delivered'),
  reference: z.string().trim().max(60, 'Keep the reference under 60 characters'),
  notes: z.string().trim().max(2000, 'Keep notes under 2,000 characters'),
});
export type PurchaseFormInput = z.output<typeof purchaseFormSchema>;

export const purchaseLineFormSchema = z.object({
  itemId: z.uuid('Choose an item'),
  quantity: quantitySchema,
  unitCost: moneySchema,
});
export type PurchaseLineFormInput = z.output<typeof purchaseLineFormSchema>;

export const adjustmentFormSchema = z.object({
  itemId: z.uuid('Choose an item'),
  locationId: z.uuid('Choose a location'),
  quantity: signedQuantitySchema,
  reason: z
    .string()
    .trim()
    .min(1, 'Say why the stock changed')
    .max(200, 'Keep the reason under 200 characters'),
});
export type AdjustmentFormInput = z.output<typeof adjustmentFormSchema>;

export const transferFormSchema = z
  .object({
    itemId: z.uuid('Choose an item'),
    from: z.uuid('Choose where it comes from'),
    to: z.uuid('Choose where it goes'),
    quantity: quantitySchema,
    note: z.string().trim().max(200, 'Keep the note under 200 characters'),
  })
  .refine((t) => t.from !== t.to, { message: 'Choose two different locations', path: ['to'] });
export type TransferFormInput = z.output<typeof transferFormSchema>;

/** "2", "1.5", "0.25": a numeric(…,3) value without trailing zeros. */
export function formatQuantity(value: number | string, locale = 'en'): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(Number(value));
}
