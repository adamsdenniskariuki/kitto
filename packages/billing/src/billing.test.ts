import { describe, expect, it } from 'vitest';
import { KittoError } from '@kitto/core';
import {
  documentTotals,
  formatTaxRate,
  lineAmounts,
  percentToBp,
  quantityHundredths,
} from './math';
import {
  invoiceFormSchema,
  lineFormSchema,
  linesFromForm,
  paymentFormSchema,
  sourceSchema,
  toLineInput,
  voidFormSchema,
} from './schemas';
import { billingErrorCode, billingNav } from './shared';
import { canConvert, canVoid, isPayable, statusLabel } from './status';

describe('line math (mirrors the SQL generated columns)', () => {
  it('multiplies and adds tax on top', () => {
    expect(lineAmounts({ quantity: 2, unitPriceMinor: 150000, taxRateBp: 1600 })).toEqual({
      subtotalMinor: 300000,
      taxMinor: 48000,
      totalMinor: 348000,
    });
  });

  it('rounds half up per line, tax on the rounded subtotal', () => {
    // 1.5 x 33 = 49.5 -> 50; 50 x 16% = 8
    expect(lineAmounts({ quantity: '1.5', unitPriceMinor: 33, taxRateBp: 1600 })).toEqual({
      subtotalMinor: 50,
      taxMinor: 8,
      totalMinor: 58,
    });
    // 0.25 x 10 = 2.5 -> 3; 3 x 50% = 1.5 -> 2
    expect(lineAmounts({ quantity: '0.25', unitPriceMinor: 10, taxRateBp: 5000 }).taxMinor).toBe(2);
  });

  it('stays exact on large amounts', () => {
    expect(
      lineAmounts({ quantity: '9999.99', unitPriceMinor: 99_999_999, taxRateBp: 1600 })
        .subtotalMinor,
    ).toBe(999_998_990_000);
  });

  it('treats invalid input as zero', () => {
    expect(lineAmounts({ quantity: '1.234', unitPriceMinor: 100, taxRateBp: 0 }).totalMinor).toBe(
      0,
    );
    expect(lineAmounts({ quantity: '1', unitPriceMinor: -5, taxRateBp: 0 }).totalMinor).toBe(0);
  });

  it('sums document totals', () => {
    expect(
      documentTotals([
        { quantity: 1, unitPriceMinor: 1000, taxRateBp: 1600 },
        { quantity: 3, unitPriceMinor: 250, taxRateBp: 0 },
      ]),
    ).toEqual({ subtotalMinor: 1750, taxMinor: 160, totalMinor: 1910 });
  });

  it('parses quantities and tax rates', () => {
    expect(quantityHundredths('2.5')).toBe(250n);
    expect(quantityHundredths('abc')).toBeNull();
    expect(percentToBp('16')).toBe(1600);
    expect(percentToBp('12.5')).toBe(1250);
    expect(percentToBp('')).toBe(0);
    expect(percentToBp('101')).toBeNull();
    expect(formatTaxRate(1600)).toBe('16%');
    expect(formatTaxRate(1250)).toBe('12.5%');
  });
});

describe('form schemas', () => {
  const fd = (pairs: [string, string][]) => {
    const f = new FormData();
    for (const [k, v] of pairs) f.append(k, v);
    return f;
  };

  it('zips repeated line fields and drops blank rows', () => {
    const rows = linesFromForm(
      fd([
        ['lineDescription', 'Room'],
        ['lineQuantity', '2'],
        ['linePrice', '4,500'],
        ['lineTax', '16'],
        ['lineDescription', ''],
        ['lineQuantity', '1'],
        ['linePrice', ''],
        ['lineTax', '0'],
      ]),
    );
    expect(rows).toEqual([
      { description: 'Room', quantity: '2', unitPrice: '4,500', taxRate: '16' },
    ]);
    expect(lineFormSchema.parse(toLineInput(rows[0]!))).toEqual({
      description: 'Room',
      quantity: 2,
      unitPrice: 4500,
      taxRateBp: 1600,
    });
  });

  it('validates lines', () => {
    const line = { description: 'X', quantity: '1', unitPrice: '10', taxRateBp: '0' };
    expect(lineFormSchema.safeParse({ ...line, quantity: '0' }).success).toBe(false);
    expect(lineFormSchema.safeParse({ ...line, quantity: '1.234' }).success).toBe(false);
    expect(lineFormSchema.safeParse({ ...line, unitPrice: '-1' }).success).toBe(false);
    expect(lineFormSchema.safeParse({ ...line, taxRateBp: '120' }).success).toBe(false);
    expect(lineFormSchema.safeParse({ ...line, description: '  ' }).success).toBe(false);
    expect(lineFormSchema.parse({ ...line, taxRateBp: '' }).taxRateBp).toBe(0);
  });

  it('parses a draft', () => {
    const ok = invoiceFormSchema.parse({
      kind: 'quote',
      customerId: '',
      dueDate: '',
      notes: ' thanks ',
      lines: [{ description: 'X', quantity: '1', unitPrice: '10', taxRateBp: '0' }],
    });
    expect(ok).toMatchObject({ kind: 'quote', customerId: null, dueDate: null, notes: 'thanks' });
    expect(
      invoiceFormSchema.safeParse({
        kind: 'invoice',
        customerId: '',
        dueDate: '',
        notes: '',
        lines: [],
      }).success,
    ).toBe(false);
    expect(
      invoiceFormSchema.safeParse({
        kind: 'receipt',
        customerId: '',
        dueDate: '',
        notes: '',
        lines: [{ description: 'X', quantity: '1', unitPrice: '1', taxRateBp: '0' }],
      }).success,
    ).toBe(false);
  });

  it('parses payments, void reasons and sources', () => {
    expect(
      paymentFormSchema.parse({ amount: '1,500.50', method: 'mpesa', reference: ' ', note: '' }),
    ).toEqual({ amount: 1500.5, method: 'mpesa', reference: null, note: '' });
    expect(
      paymentFormSchema.safeParse({ amount: '0', method: 'cash', reference: '', note: '' }).success,
    ).toBe(false);
    expect(
      paymentFormSchema.safeParse({ amount: '10', method: 'cheque', reference: '', note: '' })
        .success,
    ).toBe(false);
    expect(voidFormSchema.safeParse({ reason: '  ' }).success).toBe(false);
    expect(
      sourceSchema.safeParse({ type: 'reservation', id: '7d1d6c34-5b8e-4d2c-9a43-2f6f0e1c9b11' })
        .success,
    ).toBe(true);
    expect(sourceSchema.safeParse({ type: 'Bad Type', id: 'x' }).success).toBe(false);
  });
});

describe('billingErrorCode', () => {
  const e = (message: string, code = '22023') => new KittoError(message, code);
  it.each([
    ['Only drafts can be edited', 'locked'],
    ['Only drafts can be issued', 'not_draft'],
    ['A document needs at least one line', 'no_lines'],
    ['The total must be above zero to issue', 'zero_total'],
    ['Only issued documents without payments can be voided', 'cannot_void'],
    ['A reason is required to void', 'void_reason'],
    ['Only issued quotes can be converted', 'cannot_convert'],
    ['Payments can only be recorded against issued, unpaid invoices', 'not_payable'],
    ['Payment exceeds the balance due', 'overpayment'],
  ])('%s -> %s', (message, code) => {
    expect(billingErrorCode(e(message))).toBe(code);
  });

  it('falls back to the common codes', () => {
    expect(billingErrorCode(e('Permission denied', '42501'))).toBe('forbidden');
    expect(billingErrorCode(e('Something odd'))).toBe('invalid');
    expect(billingErrorCode(e('dup', '23505'))).toBe('exists');
    expect(billingErrorCode(new Error('x'))).toBe('failed');
  });
});

describe('status helpers', () => {
  const doc = (kind: string, status: string, paid = 0) => ({ kind, status, paid_minor: paid });
  it('labels', () => {
    expect(statusLabel('quote', 'issued')).toBe('Sent');
    expect(statusLabel('invoice', 'partially_paid')).toBe('Part paid');
  });
  it('decides what can happen next', () => {
    expect(isPayable(doc('invoice', 'issued'))).toBe(true);
    expect(isPayable(doc('invoice', 'partially_paid', 5))).toBe(true);
    expect(isPayable(doc('invoice', 'paid', 5))).toBe(false);
    expect(isPayable(doc('quote', 'issued'))).toBe(false);
    expect(canVoid(doc('invoice', 'issued'))).toBe(true);
    expect(canVoid(doc('invoice', 'partially_paid', 5))).toBe(false);
    expect(canVoid(doc('invoice', 'draft'))).toBe(false);
    expect(canConvert(doc('quote', 'issued'))).toBe(true);
    expect(canConvert(doc('quote', 'accepted'))).toBe(false);
  });
  it('builds nav only with billing.view', () => {
    const ctx = (perms: string[]) => ({
      can: (p: string) => perms.includes(p),
      path: (p = '/') => `/t/acme${p}`,
    });
    expect(billingNav(ctx(['billing.view']))).toEqual([
      { href: '/t/acme/invoices', label: 'Invoices' },
    ]);
    expect(billingNav(ctx([]))).toEqual([]);
  });
});
