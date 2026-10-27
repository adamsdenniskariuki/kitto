import { commonErrorCode, KittoError } from '@kitto/core';
import type { ZodError } from 'zod';
import { INVENTORY_PERMISSIONS as P } from './permissions';

export const INVENTORY_NOTICES = {
  item_created: 'Item added.',
  item_saved: 'Item saved.',
  item_deleted: 'Item deleted.',
  supplier_created: 'Supplier added.',
  supplier_saved: 'Supplier saved.',
  supplier_deleted: 'Supplier deleted.',
  location_created: 'Location added.',
  location_saved: 'Location saved.',
  location_deleted: 'Location deleted.',
  purchase_created: 'Purchase started. Add what was bought, then receive it.',
  purchase_saved: 'Purchase saved.',
  purchase_deleted: 'Purchase deleted.',
  line_added: 'Line added.',
  line_removed: 'Line removed.',
  received: 'Purchase received. Stock is updated.',
  adjusted: 'Stock adjusted.',
  transferred: 'Stock moved.',
} as const;

export const INVENTORY_ERRORS = {
  insufficient_stock: 'There is not enough stock for that. Receive or adjust stock first.',
  not_tracked: 'That item does not track stock.',
  keep_tracking: 'This item has stock history, so it must keep tracking stock.',
  reason_required: 'Give a reason for the adjustment.',
  zero_quantity: 'Enter a quantity other than zero.',
  same_location: 'Choose two different locations.',
  inactive_location: 'Stock can only be moved to an active location.',
  default_location: 'The default location cannot be deactivated or deleted.',
  received: 'This purchase has been received and can no longer be changed.',
  no_lines: 'Add at least one line before receiving.',
  sku_taken: 'Another item already uses that SKU.',
  name_taken: 'A location with that name already exists.',
  invalid_item: 'Check the item details and try again.',
  invalid_supplier: 'Check the supplier details and try again.',
  invalid_line: 'Check the line: choose an item and enter a quantity above zero.',
  invalid_quantity: 'Enter a quantity like 2 or 1.5 (at most three decimals).',
  in_use:
    'This is used by stock history or purchases, so it cannot be deleted. Mark it inactive instead.',
  not_found: 'That item, location or purchase no longer exists.',
} as const;
export type InventoryErrorCode = keyof typeof INVENTORY_ERRORS;

const MESSAGES: [RegExp, InventoryErrorCode][] = [
  [/not enough .* in stock/i, 'insufficient_stock'],
  [/does not track stock|only items that track stock/i, 'not_tracked'],
  [/must keep tracking stock/i, 'keep_tracking'],
  [/reason is required/i, 'reason_required'],
  [/quantity other than zero/i, 'zero_quantity'],
  [/quantity above zero/i, 'invalid_quantity'],
  [/two different locations/i, 'same_location'],
  [/active location/i, 'inactive_location'],
  [/default location/i, 'default_location'],
  [/received purchases|already been received/i, 'received'],
  [/at least one line/i, 'no_lines'],
];

/**
 * Classify a database error from an inventory action. Never shows database
 * text: the page maps the code to its own message.
 */
export function inventoryErrorCode(e: unknown): string {
  if (e instanceof KittoError) {
    if (e.code === '22023') {
      for (const [pattern, code] of MESSAGES) if (pattern.test(e.message)) return code;
    }
    if (e.code === '23514' && /quantity/i.test(e.message)) return 'invalid_quantity';
    if (e.isConflict && /sku/i.test(e.message)) return 'sku_taken';
    if (e.isConflict && /name/i.test(e.message)) return 'name_taken';
  }
  return commonErrorCode(e);
}

/** Map a failed form parse to the error code for its first field. */
export function formErrorCode(error: ZodError, fallback: InventoryErrorCode): InventoryErrorCode {
  const field = error.issues[0]?.path[0];
  if (field === 'quantity') return 'invalid_quantity';
  if (field === 'reason') return 'reason_required';
  if (field === 'to' || field === 'from') return 'same_location';
  return fallback;
}

/** Nav entries for apps that include the inventory module. */
export function inventoryNav(ctx: { can: (p: string) => boolean; path: (p?: string) => string }) {
  return ctx.can(P.view) ? [{ href: ctx.path('/inventory'), label: 'Inventory' }] : [];
}
