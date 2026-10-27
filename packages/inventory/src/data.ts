import { KittoError, unwrap, type KittoClient, type Tables } from '@kitto/core';
import type {
  AdjustmentFormInput,
  LocationFormInput,
  PurchaseFormInput,
  SupplierFormInput,
  TransferFormInput,
} from './schemas';

export type Item = Tables<'items'>;
export type Supplier = Tables<'suppliers'>;
export type StockLocation = Tables<'stock_locations'>;
export type Purchase = Tables<'purchases'>;
export type PurchaseLine = Tables<'purchase_lines'>;
export type StockMovement = Tables<'stock_movements'>;
export type StockLevel = Tables<'stock_levels'>;

/** An item with its total stock over all locations (the item_stock view). */
export interface ItemStock {
  item_id: string;
  sku: string | null;
  name: string;
  unit: string;
  category: string;
  reorder_level: number;
  track_stock: boolean;
  active: boolean;
  on_hand: number;
  low: boolean;
}

export type MovementRow = StockMovement & {
  item: { id: string; name: string; unit: string } | null;
  location: { id: string; name: string } | null;
};

export type PurchaseRow = Purchase & {
  supplier: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
};

export type PurchaseLineRow = PurchaseLine & {
  item: { id: string; name: string; unit: string; sku: string | null } | null;
};

export type LevelRow = StockLevel & { location: { id: string; name: string } | null };

const notFoundIfEmpty = <T>(rows: T[]) => {
  if (rows.length === 0) throw new KittoError('Permission denied', '42501');
};

const single = async <T>(
  req: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
): Promise<T | null> => {
  const res = await req;
  if (res.error) throw new KittoError(res.error.message, res.error.code);
  return res.data;
};

// ------------------------------------------------------------------ items

export async function listItemStock(
  db: KittoClient,
  tenantId: string,
  opts: { lowOnly?: boolean; activeOnly?: boolean; search?: string | undefined } = {},
): Promise<ItemStock[]> {
  let req = db.from('item_stock').select('*').eq('tenant_id', tenantId);
  if (opts.lowOnly) req = req.eq('low', true);
  if (opts.activeOnly) req = req.eq('active', true);
  if (opts.search) {
    const s = opts.search.replace(/[%_,()*\\]/g, ' ').trim();
    if (s) req = req.or(`name.ilike.%${s}%,sku.ilike.%${s}%,category.ilike.%${s}%`);
  }
  return unwrap(await req.order('name').limit(1000)) as ItemStock[];
}

/** Active items as select options ("Tusker (bottle)"), optionally only those that track stock. */
export async function itemOptions(
  db: KittoClient,
  tenantId: string,
  opts: { trackedOnly?: boolean } = {},
): Promise<{ value: string; label: string }[]> {
  let req = db
    .from('items')
    .select('id, name, unit, sku')
    .eq('tenant_id', tenantId)
    .eq('active', true);
  if (opts.trackedOnly) req = req.eq('track_stock', true);
  const rows = unwrap(await req.order('name').limit(1000));
  return rows.map((i) => ({
    value: i.id,
    label: `${i.name}${i.sku ? ` · ${i.sku}` : ''} (${i.unit})`,
  }));
}

export async function getItem(db: KittoClient, id: string): Promise<Item | null> {
  return single(db.from('items').select('*').eq('id', id).maybeSingle());
}

export interface ItemInput {
  sku: string | null;
  name: string;
  unit: string;
  category: string;
  description: string;
  costMinor: number | null;
  priceMinor: number | null;
  reorderLevel: number;
  trackStock: boolean;
  allowNegative: boolean;
  active: boolean;
}

const itemRow = (i: ItemInput) => ({
  sku: i.sku,
  name: i.name,
  unit: i.unit,
  category: i.category,
  description: i.description,
  cost_minor: i.costMinor,
  price_minor: i.priceMinor,
  reorder_level: i.reorderLevel,
  track_stock: i.trackStock,
  allow_negative: i.allowNegative,
  active: i.active,
});

export async function createItem(db: KittoClient, tenantId: string, input: ItemInput) {
  return unwrap(
    await db
      .from('items')
      .insert({ tenant_id: tenantId, ...itemRow(input) })
      .select()
      .single(),
  );
}

export async function updateItem(db: KittoClient, id: string, input: ItemInput) {
  return unwrap(await db.from('items').update(itemRow(input)).eq('id', id).select().single());
}

/** Delete an item with no history (23503 otherwise: deactivate it instead). */
export async function deleteItem(db: KittoClient, id: string): Promise<void> {
  notFoundIfEmpty(unwrap(await db.from('items').delete().eq('id', id).select('id')));
}

/** Stock of one item per location (only locations that ever held it). */
export async function itemLevels(db: KittoClient, itemId: string): Promise<LevelRow[]> {
  const rows = unwrap(
    await db
      .from('stock_levels')
      .select('*, location:stock_locations(id, name)')
      .eq('item_id', itemId),
  );
  return (rows as LevelRow[]).sort((a, b) =>
    (a.location?.name ?? '').localeCompare(b.location?.name ?? ''),
  );
}

// -------------------------------------------------------------- locations

export async function listLocations(
  db: KittoClient,
  tenantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<StockLocation[]> {
  let req = db.from('stock_locations').select('*').eq('tenant_id', tenantId);
  if (opts.activeOnly) req = req.eq('active', true);
  return unwrap(
    await req.order('is_default', { ascending: false }).order('position').order('name'),
  );
}

export async function createLocation(db: KittoClient, tenantId: string, input: LocationFormInput) {
  return unwrap(
    await db
      .from('stock_locations')
      .insert({ tenant_id: tenantId, name: input.name, active: input.active })
      .select()
      .single(),
  );
}

export async function updateLocation(db: KittoClient, id: string, input: LocationFormInput) {
  return unwrap(
    await db
      .from('stock_locations')
      .update({ name: input.name, active: input.active })
      .eq('id', id)
      .select()
      .single(),
  );
}

export async function deleteLocation(db: KittoClient, id: string): Promise<void> {
  notFoundIfEmpty(unwrap(await db.from('stock_locations').delete().eq('id', id).select('id')));
}

// -------------------------------------------------------------- suppliers

export async function listSuppliers(
  db: KittoClient,
  tenantId: string,
  opts: { activeOnly?: boolean } = {},
): Promise<Supplier[]> {
  let req = db.from('suppliers').select('*').eq('tenant_id', tenantId);
  if (opts.activeOnly) req = req.eq('active', true);
  return unwrap(await req.order('name').limit(1000));
}

export async function getSupplier(db: KittoClient, id: string): Promise<Supplier | null> {
  return single(db.from('suppliers').select('*').eq('id', id).maybeSingle());
}

const supplierRow = (s: SupplierFormInput) => ({
  name: s.name,
  contact_name: s.contactName,
  phone: s.phone,
  email: s.email,
  notes: s.notes,
  active: s.active,
});

export async function createSupplier(db: KittoClient, tenantId: string, input: SupplierFormInput) {
  return unwrap(
    await db
      .from('suppliers')
      .insert({ tenant_id: tenantId, ...supplierRow(input) })
      .select()
      .single(),
  );
}

export async function updateSupplier(db: KittoClient, id: string, input: SupplierFormInput) {
  return unwrap(
    await db.from('suppliers').update(supplierRow(input)).eq('id', id).select().single(),
  );
}

export async function deleteSupplier(db: KittoClient, id: string): Promise<void> {
  notFoundIfEmpty(unwrap(await db.from('suppliers').delete().eq('id', id).select('id')));
}

// -------------------------------------------------------------- purchases

const PURCHASE_SELECT =
  '*, supplier:suppliers(id, name), location:stock_locations(id, name)' as const;

export async function listPurchases(
  db: KittoClient,
  tenantId: string,
  opts: { supplierId?: string | undefined; limit?: number } = {},
): Promise<PurchaseRow[]> {
  let req = db.from('purchases').select(PURCHASE_SELECT).eq('tenant_id', tenantId);
  if (opts.supplierId) req = req.eq('supplier_id', opts.supplierId);
  const rows = unwrap(await req.order('created_at', { ascending: false }).limit(opts.limit ?? 200));
  return rows as PurchaseRow[];
}

export async function getPurchase(db: KittoClient, id: string): Promise<PurchaseRow | null> {
  return (await single(
    db.from('purchases').select(PURCHASE_SELECT).eq('id', id).maybeSingle(),
  )) as PurchaseRow | null;
}

export async function listPurchaseLines(
  db: KittoClient,
  purchaseId: string,
): Promise<PurchaseLineRow[]> {
  const rows = unwrap(
    await db
      .from('purchase_lines')
      .select('*, item:items(id, name, unit, sku)')
      .eq('purchase_id', purchaseId)
      .order('position'),
  );
  return rows as PurchaseLineRow[];
}

export async function createPurchase(db: KittoClient, tenantId: string, input: PurchaseFormInput) {
  return unwrap(
    await db
      .from('purchases')
      .insert({
        tenant_id: tenantId,
        supplier_id: input.supplierId,
        location_id: input.locationId,
        reference: input.reference,
        notes: input.notes,
      })
      .select()
      .single(),
  );
}

export async function updatePurchase(db: KittoClient, id: string, input: PurchaseFormInput) {
  return unwrap(
    await db
      .from('purchases')
      .update({
        supplier_id: input.supplierId,
        location_id: input.locationId,
        reference: input.reference,
        notes: input.notes,
      })
      .eq('id', id)
      .select()
      .single(),
  );
}

/** Delete a draft purchase (received ones are kept: RLS hides them from delete). */
export async function deletePurchase(db: KittoClient, id: string): Promise<void> {
  notFoundIfEmpty(unwrap(await db.from('purchases').delete().eq('id', id).select('id')));
}

export async function addPurchaseLine(
  db: KittoClient,
  tenantId: string,
  purchaseId: string,
  input: { itemId: string; quantity: number; unitCostMinor: number; position: number },
): Promise<void> {
  unwrap(
    await db
      .from('purchase_lines')
      .insert({
        tenant_id: tenantId,
        purchase_id: purchaseId,
        item_id: input.itemId,
        quantity: input.quantity,
        unit_cost_minor: input.unitCostMinor,
        position: input.position,
      })
      .select('id'),
  );
}

export async function removePurchaseLine(db: KittoClient, lineId: string): Promise<void> {
  notFoundIfEmpty(unwrap(await db.from('purchase_lines').delete().eq('id', lineId).select('id')));
}

/** Book a draft purchase into stock (and update item costs). All or nothing. */
export async function receivePurchase(
  db: KittoClient,
  id: string,
  updateCosts = true,
): Promise<Purchase> {
  return unwrap(
    await db.rpc('receive_purchase', { p_purchase_id: id, p_update_costs: updateCosts }).single(),
  ) as Purchase;
}

// ---------------------------------------------------------------- ledger

export async function listMovements(
  db: KittoClient,
  tenantId: string,
  opts: {
    itemId?: string | undefined;
    locationId?: string | undefined;
    sourceType?: string | undefined;
    sourceId?: string | undefined;
    limit?: number;
  } = {},
): Promise<MovementRow[]> {
  let req = db
    .from('stock_movements')
    .select('*, item:items(id, name, unit), location:stock_locations(id, name)')
    .eq('tenant_id', tenantId);
  if (opts.itemId) req = req.eq('item_id', opts.itemId);
  if (opts.locationId) req = req.eq('location_id', opts.locationId);
  if (opts.sourceType) req = req.eq('source_type', opts.sourceType);
  if (opts.sourceId) req = req.eq('source_id', opts.sourceId);
  const rows = unwrap(
    await req
      .order('created_at', { ascending: false })
      .order('quantity')
      .limit(opts.limit ?? 200),
  );
  return rows as MovementRow[];
}

export async function adjustStock(
  db: KittoClient,
  tenantId: string,
  input: AdjustmentFormInput,
): Promise<StockMovement> {
  return unwrap(
    await db
      .rpc('adjust_stock', {
        p_tenant_id: tenantId,
        p_item_id: input.itemId,
        p_location_id: input.locationId,
        p_quantity: input.quantity,
        p_reason: input.reason,
      })
      .single(),
  ) as StockMovement;
}

/** Move stock between two locations; both halves or neither. Returns the transfer id. */
export async function transferStock(
  db: KittoClient,
  tenantId: string,
  input: TransferFormInput,
): Promise<string> {
  return unwrap(
    await db.rpc('transfer_stock', {
      p_tenant_id: tenantId,
      p_item_id: input.itemId,
      p_from: input.from,
      p_to: input.to,
      p_quantity: input.quantity,
      p_note: input.note,
    }),
  );
}
