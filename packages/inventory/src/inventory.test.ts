import { describe, expect, it } from 'vitest';
import { KittoError } from '@kitto/core';
import {
  adjustmentFormSchema,
  formatQuantity,
  itemFormSchema,
  levelSchema,
  purchaseLineFormSchema,
  quantitySchema,
  signedQuantitySchema,
  supplierFormSchema,
  transferFormSchema,
} from './schemas';
import { formErrorCode, INVENTORY_ERRORS, inventoryErrorCode } from './shared';
import { isLowStock, MOVEMENT_KINDS, validMovement } from './status';

const A = '7d1d6c34-5b8e-4d2c-9a43-2f6f0e1c9b11';
const B = '0b8c8f0e-1d2c-4b5a-9e8f-7a6b5c4d3e2f';

describe('quantities', () => {
  it('accepts up to three decimals and ignores commas', () => {
    expect(quantitySchema.parse('2')).toBe(2);
    expect(quantitySchema.parse(' 1.5 ')).toBe(1.5);
    expect(quantitySchema.parse('0.125')).toBe(0.125);
    expect(quantitySchema.parse('1,250')).toBe(1250);
  });

  it('rejects zero, negatives, junk and too many decimals', () => {
    for (const v of ['0', '-1', 'abc', '1.2345', '', '1e3'])
      expect(quantitySchema.safeParse(v).success).toBe(false);
  });

  it('signed quantities allow a sign but not zero', () => {
    expect(signedQuantitySchema.parse('+5')).toBe(5);
    expect(signedQuantitySchema.parse('-2.5')).toBe(-2.5);
    expect(signedQuantitySchema.safeParse('0').success).toBe(false);
    expect(signedQuantitySchema.safeParse('-0.000').success).toBe(false);
  });

  it('levels default to zero', () => {
    expect(levelSchema.parse('')).toBe(0);
    expect(levelSchema.parse('10')).toBe(10);
    expect(levelSchema.safeParse('-1').success).toBe(false);
  });

  it('formats without trailing zeros', () => {
    expect(formatQuantity('2.000')).toBe('2');
    expect(formatQuantity(1.5)).toBe('1.5');
    expect(formatQuantity(1234.125, 'en')).toBe('1,234.125');
  });
});

describe('item form', () => {
  const base = {
    sku: '',
    name: 'Tusker',
    unit: '',
    category: 'Drinks',
    description: '',
    cost: '120',
    price: '',
    reorderLevel: '12',
    trackStock: true,
    allowNegative: false,
    active: true,
  };

  it('normalises blanks', () => {
    const item = itemFormSchema.parse(base);
    expect(item).toMatchObject({
      sku: null,
      unit: 'each',
      cost: 120,
      price: null,
      reorderLevel: 12,
    });
  });

  it('validates the SKU', () => {
    expect(itemFormSchema.parse({ ...base, sku: 'BRK-001/A' }).sku).toBe('BRK-001/A');
    expect(itemFormSchema.safeParse({ ...base, sku: 'has space' }).success).toBe(false);
    expect(itemFormSchema.safeParse({ ...base, sku: '-lead' }).success).toBe(false);
  });

  it('rejects bad prices and missing names', () => {
    expect(itemFormSchema.safeParse({ ...base, cost: '-1' }).success).toBe(false);
    expect(itemFormSchema.safeParse({ ...base, name: ' ' }).success).toBe(false);
  });
});

describe('other forms', () => {
  it('supplier email is optional but checked', () => {
    const s = {
      name: 'Brewers',
      contactName: '',
      phone: '',
      email: '',
      notes: '',
      active: true,
    };
    expect(supplierFormSchema.parse(s)).toMatchObject({ phone: null, email: null });
    expect(supplierFormSchema.safeParse({ ...s, email: 'nope' }).success).toBe(false);
  });

  it('purchase lines need an item and a positive quantity', () => {
    expect(purchaseLineFormSchema.parse({ itemId: A, quantity: '24', unitCost: '' })).toEqual({
      itemId: A,
      quantity: 24,
      unitCost: 0,
    });
    expect(
      purchaseLineFormSchema.safeParse({ itemId: A, quantity: '0', unitCost: '1' }).success,
    ).toBe(false);
  });

  it('adjustments need a reason', () => {
    const a = { itemId: A, locationId: B, quantity: '-2', reason: '' };
    const res = adjustmentFormSchema.safeParse(a);
    expect(res.success).toBe(false);
    if (!res.success) expect(formErrorCode(res.error, 'invalid_line')).toBe('reason_required');
    expect(adjustmentFormSchema.parse({ ...a, reason: 'Broken' }).quantity).toBe(-2);
  });

  it('transfers need two different locations', () => {
    const t = { itemId: A, from: B, to: B, quantity: '1', note: '' };
    const res = transferFormSchema.safeParse(t);
    expect(res.success).toBe(false);
    if (!res.success) expect(formErrorCode(res.error, 'invalid_line')).toBe('same_location');
    expect(transferFormSchema.safeParse({ ...t, to: A }).success).toBe(true);
  });
});

describe('status mirror', () => {
  it('matches the stock_movements sign check', () => {
    expect(MOVEMENT_KINDS).toEqual(['purchase', 'sale', 'return', 'adjustment', 'transfer']);
    expect(validMovement('purchase', 5)).toBe(true);
    expect(validMovement('purchase', -5)).toBe(false);
    expect(validMovement('sale', -1)).toBe(true);
    expect(validMovement('sale', 1)).toBe(false);
    expect(validMovement('return', 1)).toBe(true);
    expect(validMovement('adjustment', -3)).toBe(true);
    expect(validMovement('transfer', 3)).toBe(true);
    expect(validMovement('adjustment', 0)).toBe(false);
    expect(validMovement('gift', 1)).toBe(false);
  });

  it('flags low stock like the item_stock view', () => {
    const item = { track_stock: true, active: true, on_hand: 5, reorder_level: 5 };
    expect(isLowStock(item)).toBe(true);
    expect(isLowStock({ ...item, on_hand: 6 })).toBe(false);
    expect(isLowStock({ ...item, reorder_level: 0, on_hand: 0 })).toBe(false);
    expect(isLowStock({ ...item, reorder_level: 0, on_hand: -1 })).toBe(true);
    expect(isLowStock({ ...item, track_stock: false })).toBe(false);
    expect(isLowStock({ ...item, active: false })).toBe(false);
  });
});

describe('error mapping', () => {
  const e = (message: string, code = '22023') => inventoryErrorCode(new KittoError(message, code));

  it('maps database messages to codes without leaking text', () => {
    expect(e('Not enough Tusker in stock at Bar')).toBe('insufficient_stock');
    expect(e('Water does not track stock')).toBe('not_tracked');
    expect(e('A reason is required for stock adjustments')).toBe('reason_required');
    expect(e('Choose two different locations')).toBe('same_location');
    expect(e('Stock can only be moved to an active location')).toBe('inactive_location');
    expect(e('The default location cannot be deleted')).toBe('default_location');
    expect(e('This purchase has already been received')).toBe('received');
    expect(e('A purchase needs at least one line')).toBe('no_lines');
    expect(e('An item with stock history must keep tracking stock')).toBe('keep_tracking');
    expect(e('duplicate key value violates "items_tenant_sku_idx"', '23505')).toBe('sku_taken');
    expect(e('duplicate key "stock_locations_tenant_name_idx"', '23505')).toBe('name_taken');
    expect(e('violates foreign key', '23503')).toBe('in_use');
    expect(e('Item not found', 'P0002')).toBe('not_found');
    expect(e('something else')).toBe('invalid');
    expect(inventoryErrorCode(new Error('boom'))).toBe('failed');
  });

  it('every mapped code has a message', () => {
    for (const code of ['insufficient_stock', 'not_tracked', 'reason_required', 'sku_taken'])
      expect(INVENTORY_ERRORS).toHaveProperty(code);
  });
});
