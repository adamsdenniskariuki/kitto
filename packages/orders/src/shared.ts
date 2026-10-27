import { commonErrorCode, KittoError } from '@kitto/core';
import type { ZodError } from 'zod';
import { ORDER_PERMISSIONS as P } from './permissions';

export const ORDER_NOTICES = {
  order_created: 'Order opened. Add lines, then send it.',
  order_saved: 'Order saved.',
  line_added: 'Line added.',
  line_removed: 'Line removed.',
  sent: 'Order sent. Stock has been taken.',
  fulfilled: 'Order fulfilled.',
  paid: 'Order paid.',
  cancelled: 'Order cancelled. Any stock it took has been returned.',
} as const;

export const ORDER_ERRORS = {
  insufficient_stock:
    'There is not enough stock to send this order. Receive or move stock, or change the lines.',
  locked: 'Lines can only be changed while the order is open.',
  frozen: 'This order is finished and can no longer be changed.',
  bad_transition: 'The order cannot move to that status from where it is now.',
  no_lines: 'Add at least one line before sending the order.',
  location_locked: 'The stock location can only change while the order is open.',
  reservation_cancelled: 'Orders cannot be charged to a cancelled reservation.',
  item_inactive: 'That item is no longer sold.',
  invoiced: 'This order is on an invoice. Record the payment on the invoice.',
  charged: 'This order is charged to a reservation and is paid with its invoice.',
  invalid_order: 'Check the order details and try again.',
  invalid_line: 'Check the line: choose an item or describe it, and enter a quantity above zero.',
  invalid_quantity: 'Enter a quantity like 2 or 1.5 (at most three decimals).',
  price_required: 'Enter a price for a line without an item.',
  not_found: 'That order, item or reservation no longer exists.',
} as const;
export type OrderErrorCode = keyof typeof ORDER_ERRORS;

const MESSAGES: [RegExp, OrderErrorCode][] = [
  [/not enough .* in stock/i, 'insufficient_stock'],
  [/only open orders can be changed|cannot move between orders/i, 'locked'],
  [/can no longer be changed/i, 'frozen'],
  [/cannot become/i, 'bad_transition'],
  [/at least one line/i, 'no_lines'],
  [/stock location can only change/i, 'location_locked'],
  [/cancelled reservation/i, 'reservation_cancelled'],
  [/no longer sold/i, 'item_inactive'],
  [/on an invoice/i, 'invoiced'],
  [/charged to a reservation/i, 'charged'],
];

/** Classify a database error from an order action. Never shows database text. */
export function orderErrorCode(e: unknown): string {
  if (e instanceof KittoError && e.code === '22023') {
    for (const [pattern, code] of MESSAGES) if (pattern.test(e.message)) return code;
  }
  return commonErrorCode(e);
}

/** Map a failed line parse to the error code for its first field. */
export function lineErrorCode(error: ZodError): OrderErrorCode {
  const field = error.issues[0]?.path[0];
  if (field === 'quantity') return 'invalid_quantity';
  if (field === 'unitPrice') return 'price_required';
  return 'invalid_line';
}

/** Nav entries for apps that include the orders module. */
export function ordersNav(ctx: { can: (p: string) => boolean; path: (p?: string) => string }) {
  return ctx.can(P.view) ? [{ href: ctx.path('/orders'), label: 'Orders' }] : [];
}
