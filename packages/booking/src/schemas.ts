import { z } from 'zod';
import { isLocalDateTime } from '@kitto/core';
import { RATE_UNITS } from './status';

const localDateTime = z
  .string()
  .trim()
  .refine(isLocalDateTime, 'Enter a date and time')
  .transform((v) => (v.length === 10 ? `${v}T00:00` : v.slice(0, 16)));

const time = z
  .string()
  .trim()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Enter a time like 08:00');

const int = (min: number, max: number, message: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+$/, message)
    .transform(Number)
    .pipe(z.number().int().min(min, message).max(max, message));

/** A resource as typed into a form. `rate` stays in major units; actions convert with the tenant currency. */
export const resourceFormSchema = z.object({
  kind: z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => v.replace(/[\s-]+/g, '_') || 'resource')
    .pipe(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'Use letters, numbers and underscores')),
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Keep the name under 120 characters'),
  description: z.string().trim().max(1000, 'Keep the description under 1,000 characters'),
  capacity: int(1, 10000, 'Capacity is a whole number from 1 to 10,000'),
  rate: z
    .string()
    .trim()
    .transform((v) => v.replace(/,/g, '') || '0')
    .pipe(z.string().regex(/^\d+(\.\d{1,3})?$/, 'Enter a price like 4500 or 4500.50'))
    .transform(Number),
  rateUnit: z.enum(RATE_UNITS),
  active: z.boolean(),
});
export type ResourceFormInput = z.output<typeof resourceFormSchema>;

export const openingHoursSchema = z
  .object({
    weekday: int(0, 6, 'Choose a day'),
    opens: time,
    closes: time,
  })
  .refine((h) => h.closes > h.opens, {
    message: 'Closing must be after opening',
    path: ['closes'],
  });
export type OpeningHoursInput = z.output<typeof openingHoursSchema>;

export const REPEAT_OPTIONS = ['', 'daily', 'weekly'] as const;

/** A reservation as typed into a form. Times are tenant-local wall-clock times. */
export const reservationFormSchema = z
  .object({
    resourceId: z.uuid('Choose what to book'),
    start: localDateTime,
    end: localDateTime,
    customerId: z.union([z.literal('').transform(() => null), z.uuid()]),
    guests: int(1, 10000, 'Guests is a whole number of at least 1'),
    title: z.string().trim().max(200, 'Keep the title under 200 characters'),
    notes: z.string().trim().max(2000, 'Keep notes under 2,000 characters'),
    status: z.enum(['confirmed', 'tentative']),
    repeat: z.enum(REPEAT_OPTIONS),
    occurrences: z
      .string()
      .trim()
      .transform((v) => (v === '' ? 1 : Number(v)))
      .pipe(z.number().int().min(1).max(52, 'Repeat at most 52 times')),
  })
  .refine((r) => r.end > r.start, { message: 'The end must be after the start', path: ['end'] })
  .refine((r) => r.repeat === '' || r.occurrences >= 2, {
    message: 'Repeat at least twice',
    path: ['occurrences'],
  });
export type ReservationFormInput = z.output<typeof reservationFormSchema>;

/** Minutes between two local "YYYY-MM-DDTHH:mm" times (wall-clock, ignoring DST). */
export function localMinutesBetween(start: string, end: string): number {
  const toMs = (v: string) => Date.parse(`${v}:00Z`);
  return Math.round((toMs(end) - toMs(start)) / 60000);
}

/** A local "YYYY-MM-DDTHH:mm" time plus some minutes, still as wall-clock time. */
export function addLocalMinutes(local: string, minutes: number): string {
  return new Date(Date.parse(`${local.slice(0, 16)}:00Z`) + minutes * 60000)
    .toISOString()
    .slice(0, 16);
}
