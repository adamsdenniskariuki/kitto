import { commonErrorCode, KittoError } from '@kitto/core';
import type { ZodError } from 'zod';
import { BOOKING_PERMISSIONS as P } from './permissions';

export const BOOKING_NOTICES = {
  created: 'Reservation made.',
  series_created: 'Recurring reservations made.',
  saved: 'Reservation saved.',
  status_changed: 'Reservation updated.',
  rescheduled: 'Reservation moved.',
  resource_created: 'Resource added.',
  resource_saved: 'Resource saved.',
  resource_deleted: 'Resource deleted.',
  hours_added: 'Opening hours added.',
  hours_removed: 'Opening hours removed.',
} as const;

export const BOOKING_ERRORS = {
  conflict: 'That time is already booked. Pick another time or resource.',
  bad_transition: 'That status change is not allowed.',
  final: 'This reservation is finished and can no longer be changed.',
  capacity: 'That is more guests than this resource holds.',
  inactive: 'That resource is not taking reservations.',
  invalid_time: 'Check the times: the end must be after the start.',
  invalid_resource: 'Check the resource details and try again.',
  invalid_hours: 'Check the opening hours: closing must be after opening.',
  overlapping_hours: 'Hours starting at that time are already set for that day.',
  in_use: 'This resource has reservations, so it cannot be deleted. Mark it inactive instead.',
  not_found: 'That resource or reservation no longer exists.',
} as const;

/** Classify a database error from a booking action. */
export function bookingErrorCode(e: unknown): string {
  if (e instanceof KittoError) {
    if (e.code === '23P01') return 'conflict';
    if (e.code === '22023') {
      if (/cannot become/i.test(e.message)) return 'bad_transition';
      if (/no longer be changed/i.test(e.message)) return 'final';
      if (/holds at most/i.test(e.message)) return 'capacity';
      if (/not taking reservations/i.test(e.message)) return 'inactive';
      if (/end must be after|reservations_during_valid/i.test(e.message)) return 'invalid_time';
    }
    if (e.code === '23514' && /during/i.test(e.message)) return 'invalid_time';
  }
  return commonErrorCode(e);
}

/** Opening hours: a duplicate (same day and opening time) reads as an overlap. */
export function hoursErrorCode(e: unknown): string {
  if (e instanceof KittoError && e.isConflict) return 'overlapping_hours';
  if (e instanceof KittoError && e.code === '23514') return 'invalid_hours';
  return commonErrorCode(e);
}

export function reservationFormError(error: ZodError): string {
  const field = error.issues[0]?.path[0];
  return field === 'start' || field === 'end' ? 'invalid_time' : 'invalid';
}

/** Nav entries for apps that include the booking module. */
export function bookingNav(ctx: { can: (p: string) => boolean; path: (p?: string) => string }) {
  return ctx.can(P.view) ? [{ href: ctx.path('/bookings'), label: 'Bookings' }] : [];
}
