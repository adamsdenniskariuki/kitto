import { z } from 'zod';
import { optionalMoneySchema, quantitySchema } from '@kitto/inventory/schemas';

const optionalId = (message: string) =>
  z
    .string()
    .trim()
    .transform((v) => v || null)
    .pipe(z.uuid(message).nullable());

export const orderFormSchema = z.object({
  channel: z.string().trim().max(60, 'Keep the label under 60 characters'),
  customerId: optionalId('Choose a customer'),
  reservationId: optionalId('Choose a reservation'),
  locationId: optionalId('Choose where stock comes from'),
  notes: z.string().trim().max(2000, 'Keep notes under 2,000 characters'),
});
export type OrderFormInput = z.output<typeof orderFormSchema>;

/**
 * A line is an inventory item (its name and price are used unless given) or
 * free text with a price.
 */
export const orderLineFormSchema = z
  .object({
    itemId: optionalId('Choose an item'),
    description: z.string().trim().max(200, 'Keep the description under 200 characters'),
    quantity: quantitySchema,
    unitPrice: optionalMoneySchema,
    note: z.string().trim().max(200, 'Keep the note under 200 characters'),
  })
  .refine((l) => l.itemId !== null || l.description !== '', {
    message: 'Choose an item or describe the line',
    path: ['description'],
  })
  .refine((l) => l.itemId !== null || l.unitPrice !== null, {
    message: 'Enter a price for a line without an item',
    path: ['unitPrice'],
  });
export type OrderLineFormInput = z.output<typeof orderLineFormSchema>;

export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(500, 'Keep the reason under 500 characters'),
});
