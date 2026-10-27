import type { Tone } from '@kitto/ui';
import { ORDER_PERMISSIONS as P } from './permissions';

/**
 * The order status machine. The database enforces it
 * (private.order_status_flow); this mirror only decides which buttons to
 * show.
 *
 *   open -> sent -> fulfilled -> paid
 *     \------\--> cancelled
 *
 * Sending consumes stock; cancelling a sent order returns it.
 */
export const ORDER_STATUSES = ['open', 'sent', 'fulfilled', 'paid', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  open: ['sent', 'cancelled'],
  sent: ['fulfilled', 'cancelled'],
  fulfilled: ['paid'],
  paid: [],
  cancelled: [],
};

/** Orders still in progress (the default list). */
export const ACTIVE_STATUSES: readonly OrderStatus[] = ['open', 'sent', 'fulfilled'];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: 'Open',
  sent: 'Sent',
  fulfilled: 'Fulfilled',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const ORDER_STATUS_TONES: Record<OrderStatus, Tone> = {
  open: 'warning',
  sent: 'brand',
  fulfilled: 'brand',
  paid: 'success',
  cancelled: 'neutral',
};

/** Button labels for moving an order into a status. */
export const ORDER_STATUS_ACTIONS: Record<OrderStatus, string> = {
  open: 'Reopen',
  sent: 'Send order',
  fulfilled: 'Mark fulfilled',
  paid: 'Mark paid',
  cancelled: 'Cancel order',
};

/** The permission each step needs (mirror of public.set_order_status). */
export const ORDER_STATUS_PERMISSIONS: Record<OrderStatus, string> = {
  open: P.create,
  sent: P.serve,
  fulfilled: P.serve,
  paid: P.bill,
  cancelled: P.cancel,
};

export function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: string, to: string): boolean {
  return isOrderStatus(from) && isOrderStatus(to) && ORDER_TRANSITIONS[from].includes(to);
}

/** Paid and cancelled orders are final: nothing about them changes. */
export function isFinal(status: string): boolean {
  return status === 'paid' || status === 'cancelled';
}

/** Whether stock has been taken for an order in this status. */
export function consumesStock(status: string): boolean {
  return status === 'sent' || status === 'fulfilled' || status === 'paid';
}

/**
 * The status changes a user may make now. An order on an invoice, or charged
 * to a reservation, is paid through that invoice, so "Mark paid" is hidden.
 */
export function nextStatuses(
  order: { status: string; invoice_id: string | null; reservation_id: string | null },
  can: (permission: string) => boolean,
): OrderStatus[] {
  if (!isOrderStatus(order.status)) return [];
  return ORDER_TRANSITIONS[order.status].filter(
    (s) =>
      can(ORDER_STATUS_PERMISSIONS[s]) &&
      !(s === 'paid' && (order.invoice_id !== null || order.reservation_id !== null)),
  );
}
