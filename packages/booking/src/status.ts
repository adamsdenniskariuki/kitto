import type { Tone } from '@kitto/ui';

/**
 * The reservation status machine. The database enforces it
 * (private.reservation_status_flow); this mirror only decides which buttons
 * to show.
 *
 *   tentative -> confirmed -> checked_in -> completed
 *        \            \-> no_show
 *         \-> cancelled <-/
 */
export const RESERVATION_STATUSES = [
  'tentative',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'no_show',
] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const STATUS_TRANSITIONS: Record<ReservationStatus, readonly ReservationStatus[]> = {
  tentative: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled', 'no_show'],
  checked_in: ['completed'],
  completed: [],
  cancelled: [],
  no_show: [],
};

/** Statuses that hold the resource (the exclusion constraint's WHERE clause). */
export const BLOCKING_STATUSES: readonly ReservationStatus[] = [
  'tentative',
  'confirmed',
  'checked_in',
  'completed',
];

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  tentative: 'Tentative',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

/** Button text for moving *to* a status. */
export const STATUS_ACTIONS: Record<ReservationStatus, string> = {
  tentative: 'Mark tentative',
  confirmed: 'Confirm',
  checked_in: 'Check in',
  completed: 'Complete',
  cancelled: 'Cancel reservation',
  no_show: 'Mark no-show',
};

export const STATUS_TONES: Record<ReservationStatus, Tone> = {
  tentative: 'warning',
  confirmed: 'brand',
  checked_in: 'success',
  completed: 'neutral',
  cancelled: 'danger',
  no_show: 'danger',
};

export function isReservationStatus(value: string): value is ReservationStatus {
  return (RESERVATION_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: string, to: string): boolean {
  return (
    isReservationStatus(from) && isReservationStatus(to) && STATUS_TRANSITIONS[from].includes(to)
  );
}

export function isFinal(status: string): boolean {
  return isReservationStatus(status) && STATUS_TRANSITIONS[status].length === 0;
}

export const RATE_UNITS = ['booking', 'hour', 'day', 'night'] as const;
export type RateUnit = (typeof RATE_UNITS)[number];
export const RATE_UNIT_LABELS: Record<RateUnit, string> = {
  booking: 'per booking',
  hour: 'per hour',
  day: 'per day',
  night: 'per night',
};

export const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
