'use server';

import { z } from 'zod';
import { formString, runTenantAction } from '@kitto/auth/server';
import { toMinorUnits } from '@kitto/core';
import {
  addPurchaseLine,
  adjustStock,
  createItem,
  createLocation,
  createPurchase,
  createSupplier,
  deleteItem,
  deleteLocation,
  deletePurchase,
  deleteSupplier,
  listPurchaseLines,
  receivePurchase,
  removePurchaseLine,
  transferStock,
  updateItem,
  updateLocation,
  updatePurchase,
  updateSupplier,
  type ItemInput,
} from './data';
import { INVENTORY_PERMISSIONS as P } from './permissions';
import {
  adjustmentFormSchema,
  itemFormSchema,
  locationFormSchema,
  purchaseFormSchema,
  purchaseLineFormSchema,
  supplierFormSchema,
  transferFormSchema,
} from './schemas';
import { formErrorCode, inventoryErrorCode } from './shared';

const idOf = (fd: FormData, key: string) => z.uuid().parse(formString(fd, key));
const checked = (fd: FormData, key: string) => fd.get(key) === 'on';

function parseItem(fd: FormData, currency: string): ItemInput | null {
  const parsed = itemFormSchema.safeParse({
    sku: formString(fd, 'sku'),
    name: formString(fd, 'name'),
    unit: formString(fd, 'unit'),
    category: formString(fd, 'category'),
    description: formString(fd, 'description'),
    cost: formString(fd, 'cost'),
    price: formString(fd, 'price'),
    reorderLevel: formString(fd, 'reorderLevel'),
    trackStock: checked(fd, 'trackStock'),
    allowNegative: checked(fd, 'allowNegative'),
    active: checked(fd, 'active'),
  });
  if (!parsed.success) return null;
  const { cost, price, ...rest } = parsed.data;
  return {
    ...rest,
    costMinor: cost === null ? null : toMinorUnits(cost, currency),
    priceMinor: price === null ? null : toMinorUnits(price, currency),
  };
}

// ------------------------------------------------------------------ items

export async function createItemAction(formData: FormData): Promise<void> {
  await runTenantAction(
    formData,
    P.manage,
    '/inventory/items/new',
    async (ctx) => {
      const input = parseItem(formData, ctx.tenant.currency);
      if (!input) return { error: 'invalid_item' };
      const item = await createItem(ctx.db, ctx.tenant.id, input);
      return { notice: 'item_created', path: `/inventory/items/${item.id}` };
    },
    inventoryErrorCode,
  );
}

export async function updateItemAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'itemId');
  await runTenantAction(
    formData,
    P.manage,
    `/inventory/items/${id}`,
    async (ctx) => {
      const input = parseItem(formData, ctx.tenant.currency);
      if (!input) return { error: 'invalid_item' };
      await updateItem(ctx.db, id, input);
      return { notice: 'item_saved' };
    },
    inventoryErrorCode,
  );
}

export async function deleteItemAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'itemId');
  await runTenantAction(
    formData,
    P.manage,
    `/inventory/items/${id}`,
    async (ctx) => {
      await deleteItem(ctx.db, id);
      return { notice: 'item_deleted', path: '/inventory' };
    },
    inventoryErrorCode,
  );
}

// -------------------------------------------------------------- suppliers

const supplierFields = (fd: FormData) => ({
  name: formString(fd, 'name'),
  contactName: formString(fd, 'contactName'),
  phone: formString(fd, 'phone'),
  email: formString(fd, 'email'),
  notes: formString(fd, 'notes'),
  active: checked(fd, 'active'),
});

export async function createSupplierAction(formData: FormData): Promise<void> {
  await runTenantAction(
    formData,
    P.manage,
    '/inventory/suppliers',
    async (ctx) => {
      const parsed = supplierFormSchema.safeParse(supplierFields(formData));
      if (!parsed.success) return { error: 'invalid_supplier' };
      await createSupplier(ctx.db, ctx.tenant.id, parsed.data);
      return { notice: 'supplier_created' };
    },
    inventoryErrorCode,
  );
}

export async function updateSupplierAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'supplierId');
  await runTenantAction(
    formData,
    P.manage,
    `/inventory/suppliers/${id}`,
    async (ctx) => {
      const parsed = supplierFormSchema.safeParse(supplierFields(formData));
      if (!parsed.success) return { error: 'invalid_supplier' };
      await updateSupplier(ctx.db, id, parsed.data);
      return { notice: 'supplier_saved' };
    },
    inventoryErrorCode,
  );
}

export async function deleteSupplierAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'supplierId');
  await runTenantAction(
    formData,
    P.manage,
    `/inventory/suppliers/${id}`,
    async (ctx) => {
      await deleteSupplier(ctx.db, id);
      return { notice: 'supplier_deleted', path: '/inventory/suppliers' };
    },
    inventoryErrorCode,
  );
}

// -------------------------------------------------------------- locations

export async function createLocationAction(formData: FormData): Promise<void> {
  await runTenantAction(
    formData,
    P.manage,
    '/inventory/locations',
    async (ctx) => {
      const parsed = locationFormSchema.safeParse({
        name: formString(formData, 'name'),
        active: true,
      });
      if (!parsed.success) return { error: 'invalid' };
      await createLocation(ctx.db, ctx.tenant.id, parsed.data);
      return { notice: 'location_created' };
    },
    inventoryErrorCode,
  );
}

export async function updateLocationAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'locationId');
  await runTenantAction(
    formData,
    P.manage,
    '/inventory/locations',
    async (ctx) => {
      const parsed = locationFormSchema.safeParse({
        name: formString(formData, 'name'),
        active: checked(formData, 'active'),
      });
      if (!parsed.success) return { error: 'invalid' };
      await updateLocation(ctx.db, id, parsed.data);
      return { notice: 'location_saved' };
    },
    inventoryErrorCode,
  );
}

export async function deleteLocationAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'locationId');
  await runTenantAction(
    formData,
    P.manage,
    '/inventory/locations',
    async (ctx) => {
      await deleteLocation(ctx.db, id);
      return { notice: 'location_deleted' };
    },
    inventoryErrorCode,
  );
}

// -------------------------------------------------------------- purchases

const purchaseFields = (fd: FormData) => ({
  supplierId: formString(fd, 'supplierId'),
  locationId: formString(fd, 'locationId'),
  reference: formString(fd, 'reference'),
  notes: formString(fd, 'notes'),
});

export async function createPurchaseAction(formData: FormData): Promise<void> {
  await runTenantAction(
    formData,
    P.purchase,
    '/inventory/purchases/new',
    async (ctx) => {
      const parsed = purchaseFormSchema.safeParse(purchaseFields(formData));
      if (!parsed.success) return { error: 'invalid' };
      const purchase = await createPurchase(ctx.db, ctx.tenant.id, parsed.data);
      return { notice: 'purchase_created', path: `/inventory/purchases/${purchase.id}` };
    },
    inventoryErrorCode,
  );
}

export async function updatePurchaseAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'purchaseId');
  await runTenantAction(
    formData,
    P.purchase,
    `/inventory/purchases/${id}`,
    async (ctx) => {
      const parsed = purchaseFormSchema.safeParse(purchaseFields(formData));
      if (!parsed.success) return { error: 'invalid' };
      await updatePurchase(ctx.db, id, parsed.data);
      return { notice: 'purchase_saved' };
    },
    inventoryErrorCode,
  );
}

export async function deletePurchaseAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'purchaseId');
  await runTenantAction(
    formData,
    P.purchase,
    `/inventory/purchases/${id}`,
    async (ctx) => {
      await deletePurchase(ctx.db, id);
      return { notice: 'purchase_deleted', path: '/inventory/purchases' };
    },
    inventoryErrorCode,
  );
}

export async function addPurchaseLineAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'purchaseId');
  await runTenantAction(
    formData,
    P.purchase,
    `/inventory/purchases/${id}`,
    async (ctx) => {
      const parsed = purchaseLineFormSchema.safeParse({
        itemId: formString(formData, 'itemId'),
        quantity: formString(formData, 'quantity'),
        unitCost: formString(formData, 'unitCost'),
      });
      if (!parsed.success) return { error: formErrorCode(parsed.error, 'invalid_line') };
      const lines = await listPurchaseLines(ctx.db, id);
      await addPurchaseLine(ctx.db, ctx.tenant.id, id, {
        itemId: parsed.data.itemId,
        quantity: parsed.data.quantity,
        unitCostMinor: toMinorUnits(parsed.data.unitCost, ctx.tenant.currency),
        position: lines.reduce((max, l) => Math.max(max, l.position + 1), 0),
      });
      return { notice: 'line_added' };
    },
    inventoryErrorCode,
  );
}

export async function removePurchaseLineAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'purchaseId');
  const lineId = idOf(formData, 'lineId');
  await runTenantAction(
    formData,
    P.purchase,
    `/inventory/purchases/${id}`,
    async (ctx) => {
      await removePurchaseLine(ctx.db, lineId);
      return { notice: 'line_removed' };
    },
    inventoryErrorCode,
  );
}

export async function receivePurchaseAction(formData: FormData): Promise<void> {
  const id = idOf(formData, 'purchaseId');
  await runTenantAction(
    formData,
    P.purchase,
    `/inventory/purchases/${id}`,
    async (ctx) => {
      await receivePurchase(ctx.db, id, checked(formData, 'updateCosts'));
      return { notice: 'received' };
    },
    inventoryErrorCode,
  );
}

// ---------------------------------------------------------------- ledger

export async function adjustStockAction(formData: FormData): Promise<void> {
  const itemId = formString(formData, 'itemId');
  const back = z.uuid().safeParse(itemId).success ? { item: itemId } : undefined;
  await runTenantAction(
    formData,
    P.adjust,
    '/inventory/adjust',
    async (ctx) => {
      const parsed = adjustmentFormSchema.safeParse({
        itemId,
        locationId: formString(formData, 'locationId'),
        quantity: formString(formData, 'quantity'),
        reason: formString(formData, 'reason'),
      });
      if (!parsed.success)
        return {
          error: formErrorCode(parsed.error, 'invalid_line'),
          ...(back && { params: back }),
        };
      try {
        await adjustStock(ctx.db, ctx.tenant.id, parsed.data);
      } catch (e) {
        return { error: inventoryErrorCode(e), ...(back && { params: back }) };
      }
      return { notice: 'adjusted', path: `/inventory/items/${parsed.data.itemId}` };
    },
    inventoryErrorCode,
  );
}

export async function transferStockAction(formData: FormData): Promise<void> {
  const itemId = formString(formData, 'itemId');
  const back = z.uuid().safeParse(itemId).success ? { item: itemId } : undefined;
  await runTenantAction(
    formData,
    P.transfer,
    '/inventory/transfer',
    async (ctx) => {
      const parsed = transferFormSchema.safeParse({
        itemId,
        from: formString(formData, 'from'),
        to: formString(formData, 'to'),
        quantity: formString(formData, 'quantity'),
        note: formString(formData, 'note'),
      });
      if (!parsed.success)
        return {
          error: formErrorCode(parsed.error, 'invalid_line'),
          ...(back && { params: back }),
        };
      try {
        await transferStock(ctx.db, ctx.tenant.id, parsed.data);
      } catch (e) {
        return { error: inventoryErrorCode(e), ...(back && { params: back }) };
      }
      return { notice: 'transferred', path: `/inventory/items/${parsed.data.itemId}` };
    },
    inventoryErrorCode,
  );
}
