import type { Tone } from '@kitto/ui';

/**
 * Kinds of stock movement and the sign each must have. The database enforces
 * the signs (stock_movements_sign); this mirror labels the ledger.
 */
export const MOVEMENT_KINDS = ['purchase', 'sale', 'return', 'adjustment', 'transfer'] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  purchase: 'Purchase',
  sale: 'Sale',
  return: 'Return',
  adjustment: 'Adjustment',
  transfer: 'Transfer',
};

export const MOVEMENT_TONES: Record<MovementKind, Tone> = {
  purchase: 'success',
  sale: 'brand',
  return: 'success',
  adjustment: 'warning',
  transfer: 'neutral',
};

/** The sign a movement of this kind may have: 1 (in), -1 (out) or 0 (either). */
export const MOVEMENT_SIGNS: Record<MovementKind, 1 | -1 | 0> = {
  purchase: 1,
  sale: -1,
  return: 1,
  adjustment: 0,
  transfer: 0,
};

export function isMovementKind(value: string): value is MovementKind {
  return (MOVEMENT_KINDS as readonly string[]).includes(value);
}

/** Whether a movement of `kind` may carry `quantity` (mirror of the CHECK). */
export function validMovement(kind: string, quantity: number): boolean {
  if (!isMovementKind(kind) || quantity === 0 || !Number.isFinite(quantity)) return false;
  const sign = MOVEMENT_SIGNS[kind];
  return sign === 0 || Math.sign(quantity) === sign;
}

export const PURCHASE_STATUSES = ['draft', 'received'] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];
export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  draft: 'Draft',
  received: 'Received',
};
export const PURCHASE_STATUS_TONES: Record<PurchaseStatus, Tone> = {
  draft: 'warning',
  received: 'success',
};
export function isPurchaseStatus(value: string): value is PurchaseStatus {
  return (PURCHASE_STATUSES as readonly string[]).includes(value);
}

/**
 * Low stock, as the item_stock view computes it: a tracked, active item whose
 * total on hand is negative or at/below a non-zero reorder level.
 */
export function isLowStock(item: {
  track_stock: boolean;
  active: boolean;
  on_hand: number;
  reorder_level: number;
}): boolean {
  if (!item.track_stock || !item.active) return false;
  return item.on_hand < 0 || (item.reorder_level > 0 && item.on_hand <= item.reorder_level);
}
