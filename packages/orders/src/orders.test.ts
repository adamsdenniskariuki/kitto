import { describe, expect, it } from 'vitest';
import { KittoError } from '@kitto/core';
import { lineTotalMinor, orderInvoiceLines, orderTotalMinor } from './math';
import { ORDER_PERMISSIONS as P } from './permissions';
import { cancelOrderSchema, orderFormSchema, orderLineFormSchema } from './schemas';
import type { ORDER_ERRORS } from './shared';
import { lineErrorCode, orderErrorCode } from './shared';
import {
  canTransition,
  consumesStock,
  isFinal,
  nextStatuses,
  ORDER_STATUS_ACTIONS,
  ORDER_STATUS_PERMISSIONS,
  ORDER_STATUSES,
} from './status';

const A = '7d1d6c34-5b8e-4d2c-9a43-2f6f0e1c9b11';
const all = () => true;

describe('order form', () => {
  it('turns blanks into nulls and trims', () => {
    expect(
      orderFormSchema.parse({
        channel: ' Table 4 ',
        customerId: '',
        reservationId: A,
        locationId: '',
        notes: '',
      }),
    ).toEqual({
      channel: 'Table 4',
      customerId: null,
      reservationId: A,
      locationId: null,
      notes: '',
    });
  });

  it('rejects bad ids and long labels', () => {
    const base = { channel: '', customerId: '', reservationId: '', locationId: '', notes: '' };
    expect(orderFormSchema.safeParse({ ...base, customerId: 'nope' }).success).toBe(false);
    expect(orderFormSchema.safeParse({ ...base, channel: 'x'.repeat(61) }).success).toBe(false);
  });
});

describe('order lines', () => {
  const line = { itemId: '', description: '', quantity: '1', unitPrice: '', note: '' };

  it('accepts an item line without a price (the item price is used)', () => {
    const parsed = orderLineFormSchema.parse({ ...line, itemId: A, quantity: '0.25' });
    expect(parsed).toMatchObject({ itemId: A, quantity: 0.25, unitPrice: null });
  });

  it('needs a description and a price for a free-text line', () => {
    const noText = orderLineFormSchema.safeParse({ ...line, unitPrice: '5' });
    expect(noText.success).toBe(false);
    if (!noText.success) expect(lineErrorCode(noText.error)).toBe('invalid_line');
    const noPrice = orderLineFormSchema.safeParse({ ...line, description: 'Corkage' });
    expect(noPrice.success).toBe(false);
    if (!noPrice.success) expect(lineErrorCode(noPrice.error)).toBe('price_required');
    expect(
      orderLineFormSchema.parse({ ...line, description: 'Corkage', unitPrice: '5.50' }),
    ).toMatchObject({ itemId: null, description: 'Corkage', unitPrice: 5.5 });
  });

  it('maps bad quantities to invalid_quantity', () => {
    for (const quantity of ['0', '-1', 'abc', '1.2345']) {
      const r = orderLineFormSchema.safeParse({ ...line, itemId: A, quantity });
      expect(r.success).toBe(false);
      if (!r.success) expect(lineErrorCode(r.error)).toBe('invalid_quantity');
    }
  });

  it('limits the cancel reason', () => {
    expect(cancelOrderSchema.parse({ reason: ' spilt ' }).reason).toBe('spilt');
    expect(cancelOrderSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('status machine', () => {
  it('mirrors the database flow', () => {
    expect(canTransition('open', 'sent')).toBe(true);
    expect(canTransition('sent', 'fulfilled')).toBe(true);
    expect(canTransition('fulfilled', 'paid')).toBe(true);
    expect(canTransition('open', 'cancelled')).toBe(true);
    expect(canTransition('sent', 'cancelled')).toBe(true);
    expect(canTransition('fulfilled', 'cancelled')).toBe(false);
    expect(canTransition('open', 'paid')).toBe(false);
    expect(canTransition('paid', 'open')).toBe(false);
    expect(canTransition('cancelled', 'open')).toBe(false);
    expect(canTransition('bogus', 'sent')).toBe(false);
  });

  it('knows final and stock-holding statuses', () => {
    expect(ORDER_STATUSES.filter(isFinal)).toEqual(['paid', 'cancelled']);
    expect(ORDER_STATUSES.filter(consumesStock)).toEqual(['sent', 'fulfilled', 'paid']);
  });

  it('has a label and permission for every status', () => {
    for (const s of ORDER_STATUSES) {
      expect(ORDER_STATUS_ACTIONS[s]).toBeTruthy();
      expect(Object.values(P)).toContain(ORDER_STATUS_PERMISSIONS[s]);
    }
  });

  it('offers only permitted next steps', () => {
    const order = { status: 'sent', invoice_id: null, reservation_id: null };
    expect(nextStatuses(order, all)).toEqual(['fulfilled', 'cancelled']);
    expect(nextStatuses(order, (p) => p === P.serve)).toEqual(['fulfilled']);
    expect(nextStatuses(order, () => false)).toEqual([]);
  });

  it('hides "Mark paid" for invoiced or charged orders', () => {
    const fulfilled = { status: 'fulfilled', invoice_id: null, reservation_id: null };
    expect(nextStatuses(fulfilled, all)).toEqual(['paid']);
    expect(nextStatuses({ ...fulfilled, invoice_id: A }, all)).toEqual([]);
    expect(nextStatuses({ ...fulfilled, reservation_id: A }, all)).toEqual([]);
  });
});

describe('error mapping', () => {
  const db = (message: string, code = '22023') => new KittoError(message, code);

  it('maps database messages to codes without leaking text', () => {
    const cases: [string, keyof typeof ORDER_ERRORS][] = [
      ['Not enough Beer in stock at Bar', 'insufficient_stock'],
      ['Only open orders can be changed', 'locked'],
      ['Lines cannot move between orders or items', 'locked'],
      ['This order is paid and can no longer be changed', 'frozen'],
      ['An order that is fulfilled cannot become cancelled', 'bad_transition'],
      ['An order needs at least one line', 'no_lines'],
      ['The stock location can only change while the order is open', 'location_locked'],
      ['Orders cannot be charged to a cancelled reservation', 'reservation_cancelled'],
      ['That item is no longer sold', 'item_inactive'],
      ['This order is on an invoice; record the payment there', 'invoiced'],
      ['This order is charged to a reservation and is paid with its invoice', 'charged'],
    ];
    for (const [message, code] of cases) expect(orderErrorCode(db(message))).toBe(code);
  });

  it('falls back to the common codes', () => {
    expect(orderErrorCode(db('Not enough Beer in stock at Bar', '23514'))).not.toBe(
      'insufficient_stock',
    );
    expect(orderErrorCode(new Error('boom'))).toBe(orderErrorCode(new Error('other')));
  });
});

describe('totals', () => {
  it('rounds line totals like the database', () => {
    expect(lineTotalMinor(2, 450)).toBe(900);
    expect(lineTotalMinor('1.5', 333)).toBe(500);
    expect(lineTotalMinor('0.125', 1000)).toBe(125);
    expect(lineTotalMinor(0.1, 3)).toBe(0);
    expect(lineTotalMinor(3, 0)).toBe(0);
  });

  it('sums an order', () => {
    expect(
      orderTotalMinor([
        { quantity: '2', unit_price_minor: 450 },
        { quantity: 0.5, unit_price_minor: 1000 },
      ]),
    ).toBe(1400);
    expect(orderTotalMinor([])).toBe(0);
  });

  it('builds invoice lines, folding fine quantities into one line', () => {
    expect(
      orderInvoiceLines(
        [
          { description: 'Beer', quantity: '2', unit_price_minor: 450 },
          { description: 'Cheese', quantity: '0.125', unit_price_minor: 2000, note: 'aged' },
        ],
        'Order #3 · ',
      ),
    ).toEqual([
      { description: 'Order #3 · Beer', quantity: 2, unitPriceMinor: 450, taxRateBp: 0 },
      {
        description: 'Order #3 · Cheese (aged) × 0.125',
        quantity: 1,
        unitPriceMinor: 250,
        taxRateBp: 0,
      },
    ]);
  });

  it('keeps invoice descriptions within 500 characters', () => {
    const [line] = orderInvoiceLines([
      { description: 'x'.repeat(600), quantity: '0.001', unit_price_minor: 100 },
    ]);
    expect(line?.description.length).toBe(500);
  });
});
