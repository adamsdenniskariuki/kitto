import 'server-only';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { flashMessages, fromMinorUnits } from '@kitto/core';
import {
  param,
  requirePermission,
  type TenantContext,
  type TenantPageProps,
} from '@kitto/auth/server';
import {
  Badge,
  Card,
  Checkbox,
  DataTable,
  DateTime,
  EmptyState,
  Flash,
  Money,
  PageHeader,
  SectionHeading,
  SelectField,
  TenantField,
  TextField,
  TextareaField,
  buttonClass,
} from '@kitto/ui';
import { ConfirmSubmit, SubmitButton } from '@kitto/ui/client';
import {
  addPurchaseLineAction,
  adjustStockAction,
  createItemAction,
  createLocationAction,
  createPurchaseAction,
  createSupplierAction,
  deleteItemAction,
  deleteLocationAction,
  deletePurchaseAction,
  deleteSupplierAction,
  receivePurchaseAction,
  removePurchaseLineAction,
  transferStockAction,
  updateItemAction,
  updateLocationAction,
  updatePurchaseAction,
  updateSupplierAction,
} from './actions';
import {
  getItem,
  getPurchase,
  getSupplier,
  itemLevels,
  itemOptions,
  listItemStock,
  listLocations,
  listMovements,
  listPurchaseLines,
  listPurchases,
  listSuppliers,
  type Item,
  type ItemStock,
  type MovementRow,
  type Supplier,
} from './data';
import { InventoryLiveRefresh } from './live';
import { INVENTORY_PERMISSIONS as P } from './permissions';
import { formatQuantity } from './schemas';
import { INVENTORY_ERRORS, INVENTORY_NOTICES } from './shared';
import {
  isMovementKind,
  isPurchaseStatus,
  MOVEMENT_LABELS,
  MOVEMENT_TONES,
  PURCHASE_STATUS_LABELS,
  PURCHASE_STATUS_TONES,
} from './status';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = '[+\\-]?[0-9,]+(\\.[0-9]{1,3})?';
const MONEY_PATTERN = '[0-9,]+(\\.[0-9]{1,3})?';

function flash(searchParams: TenantPageProps['searchParams']) {
  return <Flash {...flashMessages(searchParams, INVENTORY_NOTICES, INVENTORY_ERRORS)} />;
}

const qty = (value: number | string, ctx: TenantContext) =>
  formatQuantity(value, ctx.tenant.locale);

const money = (minor: number | null, ctx: TenantContext) =>
  minor === null ? '' : String(fromMinorUnits(minor, ctx.tenant.currency));

type Section = 'items' | 'low' | 'purchases' | 'suppliers' | 'locations' | 'movements';

/** Header with the inventory sub-navigation (only the sections the user may open). */
function inventoryHeader(
  ctx: TenantContext,
  title: string,
  opts: { current?: Section; description?: string; actions?: ReactNode } = {},
) {
  const sections: [Section, string, string, boolean][] = [
    ['items', 'Items', '/inventory', true],
    ['low', 'Low stock', '/inventory/low', true],
    ['purchases', 'Purchases', '/inventory/purchases', true],
    ['suppliers', 'Suppliers', '/inventory/suppliers', true],
    ['locations', 'Locations', '/inventory/locations', ctx.can(P.manage)],
    ['movements', 'Movements', '/inventory/movements', true],
  ];
  return (
    <>
      <PageHeader
        eyebrow={
          opts.current ? undefined : (
            <Link href={ctx.path('/inventory')} className="hover:underline">
              Inventory
            </Link>
          )
        }
        title={title}
        description={opts.description}
        actions={opts.actions}
      />
      {opts.current && (
        <nav aria-label="Inventory" className="mb-6 flex flex-wrap gap-2">
          {sections
            .filter(([, , , visible]) => visible)
            .map(([key, label, href]) => (
              <Link
                key={key}
                href={ctx.path(href)}
                className={buttonClass(key === opts.current ? 'primary' : 'secondary', 'sm')}
                aria-current={key === opts.current ? 'page' : undefined}
              >
                {label}
              </Link>
            ))}
        </nav>
      )}
    </>
  );
}

function OnHand({ item, ctx }: { item: ItemStock; ctx: TenantContext }) {
  if (!item.track_stock) return <span className="text-muted">Not tracked</span>;
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      <span className="tabular-nums">
        {qty(item.on_hand, ctx)} {item.unit}
      </span>
      {item.low && <Badge tone={item.on_hand < 0 ? 'danger' : 'warning'}>Low</Badge>}
    </span>
  );
}

function itemColumns(ctx: TenantContext) {
  return [
    {
      key: 'name',
      header: 'Item',
      rowHeader: true,
      cell: (i: ItemStock) => (
        <span>
          <Link href={ctx.path(`/inventory/items/${i.item_id}`)} className="underline">
            {i.name}
          </Link>
          {!i.active && (
            <>
              {' '}
              <Badge>Inactive</Badge>
            </>
          )}
        </span>
      ),
    },
    { key: 'sku', header: 'SKU', hideOnMobile: true, cell: (i: ItemStock) => i.sku ?? '' },
    {
      key: 'category',
      header: 'Category',
      hideOnMobile: true,
      cell: (i: ItemStock) => i.category,
    },
    {
      key: 'reorder',
      header: 'Reorder at',
      align: 'right' as const,
      hideOnMobile: true,
      cell: (i: ItemStock) =>
        i.track_stock && i.reorder_level > 0 ? qty(i.reorder_level, ctx) : '',
    },
    {
      key: 'onHand',
      header: 'On hand',
      align: 'right' as const,
      cell: (i: ItemStock) => <OnHand item={i} ctx={ctx} />,
    },
  ];
}

// ------------------------------------------------------------------ items

/** Items with their stock over all locations. ?q= searches name, SKU and category. */
export async function InventoryPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.view);
  const q = param(searchParams, 'q').slice(0, 60);
  const items = await listItemStock(ctx.db, ctx.tenant.id, { search: q });
  return (
    <>
      <InventoryLiveRefresh tenantId={ctx.tenant.id} />
      {inventoryHeader(ctx, 'Inventory', {
        current: 'items',
        description: 'What you stock and sell, and how much is on hand.',
        actions: (
          <>
            {ctx.can(P.adjust) && (
              <Link href={ctx.path('/inventory/adjust')} className={buttonClass('secondary')}>
                Adjust stock
              </Link>
            )}
            {ctx.can(P.transfer) && (
              <Link href={ctx.path('/inventory/transfer')} className={buttonClass('secondary')}>
                Move stock
              </Link>
            )}
            {ctx.can(P.manage) && (
              <Link href={ctx.path('/inventory/items/new')} className={buttonClass('primary')}>
                New item
              </Link>
            )}
          </>
        ),
      })}
      {flash(searchParams)}
      <form
        action={ctx.path('/inventory')}
        role="search"
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        <TextField
          label="Search items"
          name="q"
          type="search"
          defaultValue={q}
          autoComplete="off"
          wrapperClassName="min-w-0 flex-1"
        />
        <button type="submit" className={buttonClass('secondary')}>
          Search
        </button>
      </form>
      <DataTable
        caption="Items"
        hideCaption
        rows={items}
        rowKey={(i) => i.item_id}
        empty={
          <EmptyState title={q ? 'No items match' : 'No items yet'}>
            {q ? 'Try another search.' : 'Add the things you stock or sell.'}
          </EmptyState>
        }
        columns={itemColumns(ctx)}
      />
    </>
  );
}

/** Items at or below their reorder level (or below zero). Refreshes live. */
export async function LowStockPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.view);
  const items = await listItemStock(ctx.db, ctx.tenant.id, { lowOnly: true });
  return (
    <>
      <InventoryLiveRefresh tenantId={ctx.tenant.id} />
      {inventoryHeader(ctx, 'Low stock', {
        current: 'low',
        description: 'Items at or below their reorder level, over all locations.',
        actions: ctx.can(P.purchase) ? (
          <Link href={ctx.path('/inventory/purchases/new')} className={buttonClass('primary')}>
            New purchase
          </Link>
        ) : undefined,
      })}
      {flash(searchParams)}
      <DataTable
        caption="Low stock"
        hideCaption
        rows={items}
        rowKey={(i) => i.item_id}
        empty={
          <EmptyState title="Nothing is low">Every item is above its reorder level.</EmptyState>
        }
        columns={itemColumns(ctx)}
      />
    </>
  );
}

/** A dashboard card listing low-stock items (renders nothing without inventory.view). */
export async function LowStockCard({ ctx, limit = 5 }: { ctx: TenantContext; limit?: number }) {
  if (!ctx.can(P.view)) return null;
  const items = await listItemStock(ctx.db, ctx.tenant.id, { lowOnly: true });
  return (
    <Card aria-labelledby="low-stock-heading">
      <InventoryLiveRefresh tenantId={ctx.tenant.id} />
      <SectionHeading id="low-stock-heading">Low stock</SectionHeading>
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing is low.</p>
      ) : (
        <ul className="space-y-2 text-sm" aria-label="Items low on stock">
          {items.slice(0, limit).map((i) => (
            <li key={i.item_id} className="flex flex-wrap items-center justify-between gap-2">
              <Link href={ctx.path(`/inventory/items/${i.item_id}`)} className="underline">
                {i.name}
              </Link>
              <OnHand item={i} ctx={ctx} />
            </li>
          ))}
        </ul>
      )}
      {items.length > 0 && (
        <p className="mt-3 text-sm">
          <Link href={ctx.path('/inventory/low')} className="underline">
            {items.length > limit ? `See all ${items.length} low items` : 'Open low stock'}
          </Link>
        </p>
      )}
    </Card>
  );
}

function ItemFields({ item, ctx }: { item?: Item; ctx: TenantContext }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          name="name"
          required
          maxLength={120}
          autoComplete="off"
          defaultValue={item?.name}
        />
        <TextField
          label="SKU"
          name="sku"
          maxLength={40}
          autoComplete="off"
          hint="Optional code, unique in your business"
          defaultValue={item?.sku ?? ''}
        />
        <TextField
          label="Unit"
          name="unit"
          maxLength={20}
          autoComplete="off"
          hint="e.g. each, bottle, kg, litre"
          defaultValue={item?.unit ?? 'each'}
        />
        <TextField
          label="Category"
          name="category"
          maxLength={60}
          autoComplete="off"
          hint="Optional, e.g. Drinks, Brakes"
          defaultValue={item?.category}
        />
        <TextField
          label={`Cost (${ctx.tenant.currency})`}
          name="cost"
          inputMode="decimal"
          autoComplete="off"
          pattern={MONEY_PATTERN}
          hint="What one unit costs you"
          defaultValue={money(item?.cost_minor ?? null, ctx)}
        />
        <TextField
          label={`Price (${ctx.tenant.currency})`}
          name="price"
          inputMode="decimal"
          autoComplete="off"
          pattern={MONEY_PATTERN}
          hint="What one unit sells for"
          defaultValue={money(item?.price_minor ?? null, ctx)}
        />
        <TextField
          label="Reorder level"
          name="reorderLevel"
          inputMode="decimal"
          autoComplete="off"
          pattern={QUANTITY_PATTERN}
          hint="Low stock at or below this; 0 for never"
          defaultValue={item ? String(item.reorder_level) : '0'}
        />
      </div>
      <TextareaField
        label="Description"
        name="description"
        rows={2}
        maxLength={2000}
        defaultValue={item?.description}
      />
      <Checkbox
        label="Track stock"
        name="trackStock"
        defaultChecked={item?.track_stock ?? true}
        description="Turn off for services and made-to-order dishes."
      />
      <Checkbox
        label="Allow negative stock"
        name="allowNegative"
        defaultChecked={item?.allow_negative ?? false}
        description="Let sales continue when the count says none are left (counted later)."
      />
      <Checkbox
        label="Active"
        name="active"
        defaultChecked={item?.active ?? true}
        description="Inactive items keep their history but can't be bought or sold."
      />
    </>
  );
}

export async function NewItemPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.manage);
  return (
    <>
      {inventoryHeader(ctx, 'New item')}
      {flash(searchParams)}
      <Card aria-labelledby="item-heading" className="max-w-3xl">
        <SectionHeading id="item-heading">Item</SectionHeading>
        <form action={createItemAction} className="space-y-4">
          <TenantField slug={ctx.tenant.slug} />
          <ItemFields ctx={ctx} />
          <SubmitButton pendingLabel="Adding…">Add item</SubmitButton>
        </form>
      </Card>
    </>
  );
}

function MovementsTable({
  rows,
  ctx,
  caption,
  showItem = true,
}: {
  rows: MovementRow[];
  ctx: TenantContext;
  caption: string;
  showItem?: boolean;
}) {
  return (
    <DataTable
      caption={caption}
      hideCaption
      rows={rows}
      rowKey={(m) => m.id}
      empty={<EmptyState title="No stock movements yet" />}
      columns={[
        {
          key: 'when',
          header: 'When',
          rowHeader: !showItem,
          cell: (m) => <DateTime value={m.created_at} tenant={ctx.tenant} />,
        },
        ...(showItem
          ? [
              {
                key: 'item',
                header: 'Item',
                rowHeader: true,
                cell: (m: MovementRow) =>
                  m.item ? (
                    <Link href={ctx.path(`/inventory/items/${m.item.id}`)} className="underline">
                      {m.item.name}
                    </Link>
                  ) : (
                    ''
                  ),
              },
            ]
          : []),
        {
          key: 'kind',
          header: 'Kind',
          cell: (m) =>
            isMovementKind(m.kind) ? (
              <Badge tone={MOVEMENT_TONES[m.kind]}>{MOVEMENT_LABELS[m.kind]}</Badge>
            ) : (
              m.kind
            ),
        },
        { key: 'location', header: 'Location', cell: (m) => m.location?.name ?? '' },
        {
          key: 'qty',
          header: 'Change',
          align: 'right',
          cell: (m) => `${m.quantity > 0 ? '+' : ''}${qty(m.quantity, ctx)}`,
        },
        {
          key: 'reason',
          header: 'Note',
          hideOnMobile: true,
          cell: (m) => <SourceNote m={m} ctx={ctx} />,
        },
      ]}
    />
  );
}

function SourceNote({ m, ctx }: { m: MovementRow; ctx: TenantContext }) {
  const link =
    m.source_type === 'purchase' && m.source_id
      ? ctx.path(`/inventory/purchases/${m.source_id}`)
      : m.source_type === 'order' && m.source_id
        ? ctx.path(`/orders/${m.source_id}`)
        : null;
  return (
    <span>
      {m.reason}
      {link && (
        <>
          {m.reason ? ' · ' : ''}
          <Link href={link} className="underline">
            {m.source_type === 'purchase' ? 'Purchase' : 'Order'}
          </Link>
        </>
      )}
    </span>
  );
}

export interface ItemDetailPageProps extends TenantPageProps {
  itemId: string;
}

export async function ItemDetailPage({ ctx, searchParams, itemId }: ItemDetailPageProps) {
  requirePermission(ctx, P.view);
  if (!UUID.test(itemId)) notFound();
  const item = await getItem(ctx.db, itemId);
  if (!item || item.tenant_id !== ctx.tenant.id) notFound();
  const [levels, movements] = await Promise.all([
    itemLevels(ctx.db, item.id),
    listMovements(ctx.db, ctx.tenant.id, { itemId: item.id, limit: 20 }),
  ]);
  const total = levels.reduce((sum, l) => sum + Number(l.quantity), 0);
  const canManage = ctx.can(P.manage);

  return (
    <>
      <InventoryLiveRefresh tenantId={ctx.tenant.id} />
      {inventoryHeader(ctx, item.name, {
        description: item.sku ? `SKU ${item.sku}` : undefined,
        actions: item.track_stock ? (
          <>
            {ctx.can(P.adjust) && (
              <Link
                href={ctx.path(`/inventory/adjust?item=${item.id}`)}
                className={buttonClass('secondary')}
              >
                Adjust stock
              </Link>
            )}
            {ctx.can(P.transfer) && (
              <Link
                href={ctx.path(`/inventory/transfer?item=${item.id}`)}
                className={buttonClass('secondary')}
              >
                Move stock
              </Link>
            )}
          </>
        ) : undefined,
      })}
      {flash(searchParams)}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <Card aria-labelledby="item-heading">
            <SectionHeading id="item-heading">Details</SectionHeading>
            <form action={updateItemAction} className="space-y-4">
              <TenantField slug={ctx.tenant.slug} />
              <input type="hidden" name="itemId" value={item.id} />
              <fieldset disabled={!canManage} className="space-y-4">
                <ItemFields item={item} ctx={ctx} />
              </fieldset>
              {canManage && <SubmitButton pendingLabel="Saving…">Save item</SubmitButton>}
            </form>
          </Card>

          <section aria-labelledby="movements-heading">
            <SectionHeading id="movements-heading">Recent movements</SectionHeading>
            <MovementsTable
              rows={movements}
              ctx={ctx}
              caption="Recent movements"
              showItem={false}
            />
            {movements.length > 0 && (
              <p className="mt-3 text-sm">
                <Link href={ctx.path(`/inventory/movements?item=${item.id}`)} className="underline">
                  All movements for {item.name}
                </Link>
              </p>
            )}
          </section>
        </div>

        <div className="space-y-8">
          <Card aria-labelledby="stock-heading">
            <SectionHeading id="stock-heading">Stock</SectionHeading>
            {!item.track_stock ? (
              <p className="text-sm text-muted">This item does not track stock.</p>
            ) : (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-sm">
                {levels.map((l) => (
                  <div key={l.location_id} className="contents">
                    <dt className="text-muted">{l.location?.name}</dt>
                    <dd className="text-right tabular-nums">
                      {qty(l.quantity, ctx)} {item.unit}
                    </dd>
                  </div>
                ))}
                <dt className="font-semibold">Total</dt>
                <dd className="text-right font-semibold tabular-nums" data-testid="on-hand">
                  {qty(total, ctx)} {item.unit}
                </dd>
              </dl>
            )}
            {item.track_stock &&
              item.reorder_level > 0 &&
              total <= Number(item.reorder_level) &&
              item.active && (
                <p className="mt-3">
                  <Badge tone={total < 0 ? 'danger' : 'warning'}>Low stock</Badge>
                </p>
              )}
          </Card>
          {canManage && (
            <Card aria-labelledby="delete-heading">
              <SectionHeading id="delete-heading">Delete</SectionHeading>
              <p className="mb-3 text-sm text-muted">
                Only items with no stock history can be deleted. Otherwise mark it inactive.
              </p>
              <form action={deleteItemAction}>
                <TenantField slug={ctx.tenant.slug} />
                <input type="hidden" name="itemId" value={item.id} />
                <ConfirmSubmit message={`Delete ${item.name}?`}>Delete item</ConfirmSubmit>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

// -------------------------------------------------------------- suppliers

function SupplierFields({ supplier }: { supplier?: Supplier }) {
  return (
    <>
      <TextField
        label="Name"
        name="name"
        required
        maxLength={120}
        autoComplete="off"
        defaultValue={supplier?.name}
      />
      <TextField
        label="Contact person"
        name="contactName"
        maxLength={120}
        autoComplete="off"
        defaultValue={supplier?.contact_name}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Phone"
          name="phone"
          type="tel"
          maxLength={40}
          autoComplete="off"
          defaultValue={supplier?.phone ?? ''}
        />
        <TextField
          label="Email"
          name="email"
          type="email"
          maxLength={254}
          autoComplete="off"
          defaultValue={supplier?.email ?? ''}
        />
      </div>
      <TextareaField
        label="Notes"
        name="notes"
        rows={2}
        maxLength={2000}
        defaultValue={supplier?.notes}
      />
      <Checkbox label="Active" name="active" defaultChecked={supplier?.active ?? true} />
    </>
  );
}

export async function SuppliersPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.view);
  const suppliers = await listSuppliers(ctx.db, ctx.tenant.id);
  const canManage = ctx.can(P.manage);
  return (
    <>
      {inventoryHeader(ctx, 'Suppliers', {
        current: 'suppliers',
        description: 'Who you buy stock from.',
      })}
      {flash(searchParams)}
      <div className={canManage ? 'grid gap-8 lg:grid-cols-[1fr_24rem]' : ''}>
        <div className="min-w-0">
          <DataTable
            caption="Suppliers"
            hideCaption
            rows={suppliers}
            rowKey={(s) => s.id}
            empty={<EmptyState title="No suppliers yet" />}
            columns={[
              {
                key: 'name',
                header: 'Name',
                rowHeader: true,
                cell: (s) => (
                  <span>
                    <Link href={ctx.path(`/inventory/suppliers/${s.id}`)} className="underline">
                      {s.name}
                    </Link>
                    {!s.active && (
                      <>
                        {' '}
                        <Badge>Inactive</Badge>
                      </>
                    )}
                  </span>
                ),
              },
              { key: 'contact', header: 'Contact', cell: (s) => s.contact_name },
              { key: 'phone', header: 'Phone', hideOnMobile: true, cell: (s) => s.phone ?? '' },
            ]}
          />
        </div>
        {canManage && (
          <Card aria-labelledby="new-supplier-heading">
            <SectionHeading id="new-supplier-heading">New supplier</SectionHeading>
            <form action={createSupplierAction} className="space-y-4">
              <TenantField slug={ctx.tenant.slug} />
              <SupplierFields />
              <SubmitButton pendingLabel="Adding…">Add supplier</SubmitButton>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}

export interface SupplierDetailPageProps extends TenantPageProps {
  supplierId: string;
}

export async function SupplierDetailPage({
  ctx,
  searchParams,
  supplierId,
}: SupplierDetailPageProps) {
  requirePermission(ctx, P.view);
  if (!UUID.test(supplierId)) notFound();
  const supplier = await getSupplier(ctx.db, supplierId);
  if (!supplier || supplier.tenant_id !== ctx.tenant.id) notFound();
  const purchases = await listPurchases(ctx.db, ctx.tenant.id, { supplierId: supplier.id });
  const canManage = ctx.can(P.manage);
  return (
    <>
      {inventoryHeader(ctx, supplier.name)}
      {flash(searchParams)}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <Card aria-labelledby="supplier-heading">
            <SectionHeading id="supplier-heading">Details</SectionHeading>
            <form action={updateSupplierAction} className="space-y-4">
              <TenantField slug={ctx.tenant.slug} />
              <input type="hidden" name="supplierId" value={supplier.id} />
              <fieldset disabled={!canManage} className="space-y-4">
                <SupplierFields supplier={supplier} />
              </fieldset>
              {canManage && <SubmitButton pendingLabel="Saving…">Save supplier</SubmitButton>}
            </form>
          </Card>
          <section aria-labelledby="supplier-purchases-heading">
            <SectionHeading id="supplier-purchases-heading">Purchases</SectionHeading>
            <PurchasesTable rows={purchases} ctx={ctx} />
          </section>
        </div>
        {canManage && (
          <Card aria-labelledby="delete-heading">
            <SectionHeading id="delete-heading">Delete</SectionHeading>
            <p className="mb-3 text-sm text-muted">
              Suppliers with purchases can't be deleted. Mark them inactive instead.
            </p>
            <form action={deleteSupplierAction}>
              <TenantField slug={ctx.tenant.slug} />
              <input type="hidden" name="supplierId" value={supplier.id} />
              <ConfirmSubmit message={`Delete ${supplier.name}?`}>Delete supplier</ConfirmSubmit>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}

// -------------------------------------------------------------- locations

export async function LocationsPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.manage);
  const locations = await listLocations(ctx.db, ctx.tenant.id);
  return (
    <>
      {inventoryHeader(ctx, 'Locations', {
        current: 'locations',
        description: 'Where stock is kept: a store, the bar, the kitchen, a workshop.',
      })}
      {flash(searchParams)}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <ul className="min-w-0 space-y-3" aria-label="Locations">
          {locations.map((l) => (
            <li key={l.id} className="card">
              <form action={updateLocationAction} className="flex flex-wrap items-end gap-3">
                <TenantField slug={ctx.tenant.slug} />
                <input type="hidden" name="locationId" value={l.id} />
                <TextField
                  label={`Name of ${l.name}`}
                  hideLabel
                  id={`location-${l.id}-name`}
                  name="name"
                  required
                  maxLength={80}
                  autoComplete="off"
                  defaultValue={l.name}
                  wrapperClassName="min-w-0 flex-1"
                />
                {l.is_default ? (
                  <>
                    <input type="hidden" name="active" value="on" />
                    <Badge tone="brand">Default</Badge>
                  </>
                ) : (
                  <Checkbox
                    label="Active"
                    id={`location-${l.id}-active`}
                    name="active"
                    defaultChecked={l.active}
                  />
                )}
                <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
                  Save
                </SubmitButton>
              </form>
              {!l.is_default && (
                <form action={deleteLocationAction} className="mt-2">
                  <TenantField slug={ctx.tenant.slug} />
                  <input type="hidden" name="locationId" value={l.id} />
                  <ConfirmSubmit message={`Delete ${l.name}?`} variant="ghost">
                    Delete {l.name}
                  </ConfirmSubmit>
                </form>
              )}
            </li>
          ))}
        </ul>
        <Card aria-labelledby="new-location-heading">
          <SectionHeading id="new-location-heading">New location</SectionHeading>
          <form action={createLocationAction} className="space-y-4">
            <TenantField slug={ctx.tenant.slug} />
            <TextField label="Name" name="name" required maxLength={80} autoComplete="off" />
            <SubmitButton pendingLabel="Adding…">Add location</SubmitButton>
          </form>
        </Card>
      </div>
    </>
  );
}

// -------------------------------------------------------------- purchases

function PurchaseStatusBadge({ status }: { status: string }) {
  return isPurchaseStatus(status) ? (
    <Badge tone={PURCHASE_STATUS_TONES[status]}>{PURCHASE_STATUS_LABELS[status]}</Badge>
  ) : (
    <Badge>{status}</Badge>
  );
}

function PurchasesTable({
  rows,
  ctx,
}: {
  rows: Awaited<ReturnType<typeof listPurchases>>;
  ctx: TenantContext;
}) {
  return (
    <DataTable
      caption="Purchases"
      hideCaption
      rows={rows}
      rowKey={(p) => p.id}
      empty={<EmptyState title="No purchases yet" />}
      columns={[
        {
          key: 'date',
          header: 'Started',
          rowHeader: true,
          cell: (p) => (
            <Link href={ctx.path(`/inventory/purchases/${p.id}`)} className="underline">
              <DateTime value={p.created_at} tenant={ctx.tenant} dateOnly />
            </Link>
          ),
        },
        { key: 'supplier', header: 'Supplier', cell: (p) => p.supplier?.name ?? '' },
        { key: 'ref', header: 'Reference', hideOnMobile: true, cell: (p) => p.reference },
        { key: 'status', header: 'Status', cell: (p) => <PurchaseStatusBadge status={p.status} /> },
        {
          key: 'total',
          header: 'Total',
          align: 'right',
          cell: (p) => <Money minor={p.total_minor} tenant={ctx.tenant} />,
        },
      ]}
    />
  );
}

export async function PurchasesPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.view);
  const purchases = await listPurchases(ctx.db, ctx.tenant.id);
  return (
    <>
      {inventoryHeader(ctx, 'Purchases', {
        current: 'purchases',
        description: 'Stock bought from suppliers. Receiving a purchase adds it to stock.',
        actions: ctx.can(P.purchase) ? (
          <Link href={ctx.path('/inventory/purchases/new')} className={buttonClass('primary')}>
            New purchase
          </Link>
        ) : undefined,
      })}
      {flash(searchParams)}
      <PurchasesTable rows={purchases} ctx={ctx} />
    </>
  );
}

async function purchaseChoices(ctx: TenantContext) {
  const [suppliers, locations] = await Promise.all([
    listSuppliers(ctx.db, ctx.tenant.id, { activeOnly: true }),
    listLocations(ctx.db, ctx.tenant.id, { activeOnly: true }),
  ]);
  return {
    suppliers: suppliers.map((s) => ({ value: s.id, label: s.name })),
    locations: locations.map((l) => ({ value: l.id, label: l.name })),
  };
}

export async function NewPurchasePage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.purchase);
  const { suppliers, locations } = await purchaseChoices(ctx);
  return (
    <>
      {inventoryHeader(ctx, 'New purchase')}
      {flash(searchParams)}
      {suppliers.length === 0 ? (
        <EmptyState
          title="Add a supplier first"
          action={
            <Link href={ctx.path('/inventory/suppliers')} className={buttonClass('primary')}>
              Suppliers
            </Link>
          }
        />
      ) : (
        <Card aria-labelledby="purchase-heading" className="max-w-2xl">
          <SectionHeading id="purchase-heading">Purchase</SectionHeading>
          <form action={createPurchaseAction} className="space-y-4">
            <TenantField slug={ctx.tenant.slug} />
            <PurchaseFields suppliers={suppliers} locations={locations} />
            <SubmitButton pendingLabel="Starting…">Start purchase</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}

function PurchaseFields({
  suppliers,
  locations,
  purchase,
}: {
  suppliers: { value: string; label: string }[];
  locations: { value: string; label: string }[];
  purchase?: { supplier_id: string; location_id: string; reference: string; notes: string };
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Supplier"
          name="supplierId"
          options={suppliers}
          defaultValue={purchase?.supplier_id}
          required
        />
        <SelectField
          label="Deliver to"
          name="locationId"
          options={locations}
          defaultValue={purchase?.location_id}
          required
        />
      </div>
      <TextField
        label="Reference"
        name="reference"
        maxLength={60}
        autoComplete="off"
        hint="Optional, e.g. the supplier's invoice number"
        defaultValue={purchase?.reference}
      />
      <TextareaField
        label="Notes"
        name="notes"
        rows={2}
        maxLength={2000}
        defaultValue={purchase?.notes}
      />
    </>
  );
}

export interface PurchaseDetailPageProps extends TenantPageProps {
  purchaseId: string;
}

export async function PurchaseDetailPage({
  ctx,
  searchParams,
  purchaseId,
}: PurchaseDetailPageProps) {
  requirePermission(ctx, P.view);
  if (!UUID.test(purchaseId)) notFound();
  const purchase = await getPurchase(ctx.db, purchaseId);
  if (!purchase || purchase.tenant_id !== ctx.tenant.id) notFound();
  const draft = purchase.status === 'draft';
  const canEdit = draft && ctx.can(P.purchase);
  const [lines, choices, items] = await Promise.all([
    listPurchaseLines(ctx.db, purchase.id),
    canEdit ? purchaseChoices(ctx) : Promise.resolve(null),
    canEdit ? itemOptions(ctx.db, ctx.tenant.id, { trackedOnly: true }) : Promise.resolve([]),
  ]);
  // Keep a since-deactivated supplier or location selectable.
  if (
    choices &&
    purchase.supplier &&
    !choices.suppliers.some((s) => s.value === purchase.supplier_id)
  )
    choices.suppliers.unshift({ value: purchase.supplier_id, label: purchase.supplier.name });
  if (
    choices &&
    purchase.location &&
    !choices.locations.some((l) => l.value === purchase.location_id)
  )
    choices.locations.unshift({ value: purchase.location_id, label: purchase.location.name });

  return (
    <>
      {inventoryHeader(ctx, `Purchase from ${purchase.supplier?.name ?? 'supplier'}`, {
        description: purchase.reference ? `Reference ${purchase.reference}` : undefined,
      })}
      {flash(searchParams)}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="lines-heading">
            <SectionHeading id="lines-heading">Lines</SectionHeading>
            <DataTable
              caption="Purchase lines"
              hideCaption
              rows={lines}
              rowKey={(l) => l.id}
              empty={<EmptyState title="No lines yet">Add what was bought below.</EmptyState>}
              columns={[
                {
                  key: 'item',
                  header: 'Item',
                  rowHeader: true,
                  cell: (l) =>
                    l.item ? (
                      <Link href={ctx.path(`/inventory/items/${l.item.id}`)} className="underline">
                        {l.item.name}
                      </Link>
                    ) : (
                      ''
                    ),
                },
                {
                  key: 'qty',
                  header: 'Quantity',
                  align: 'right',
                  cell: (l) => `${qty(l.quantity, ctx)} ${l.item?.unit ?? ''}`,
                },
                {
                  key: 'cost',
                  header: 'Unit cost',
                  align: 'right',
                  hideOnMobile: true,
                  cell: (l) => <Money minor={l.unit_cost_minor} tenant={ctx.tenant} />,
                },
                {
                  key: 'total',
                  header: 'Total',
                  align: 'right',
                  cell: (l) => <Money minor={l.line_total_minor ?? 0} tenant={ctx.tenant} />,
                },
                ...(canEdit
                  ? [
                      {
                        key: 'remove',
                        header: <span className="sr-only">Remove</span>,
                        align: 'right' as const,
                        cell: (l: (typeof lines)[number]) => (
                          <form action={removePurchaseLineAction}>
                            <TenantField slug={ctx.tenant.slug} />
                            <input type="hidden" name="purchaseId" value={purchase.id} />
                            <input type="hidden" name="lineId" value={l.id} />
                            <SubmitButton size="sm" variant="ghost">
                              Remove<span className="sr-only"> {l.item?.name}</span>
                            </SubmitButton>
                          </form>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            <p className="mt-3 text-right font-semibold">
              Total <Money minor={purchase.total_minor} tenant={ctx.tenant} />
            </p>
          </section>

          {canEdit && (
            <Card aria-labelledby="add-line-heading">
              <SectionHeading id="add-line-heading">Add a line</SectionHeading>
              {items.length === 0 ? (
                <p className="text-sm text-muted">
                  Add an item that tracks stock first, under{' '}
                  <Link href={ctx.path('/inventory/items/new')} className="underline">
                    New item
                  </Link>
                  .
                </p>
              ) : (
                <form action={addPurchaseLineAction} className="grid gap-4 sm:grid-cols-4">
                  <TenantField slug={ctx.tenant.slug} />
                  <input type="hidden" name="purchaseId" value={purchase.id} />
                  <SelectField
                    label="Item"
                    name="itemId"
                    options={items}
                    placeholder="Choose an item"
                    required
                    wrapperClassName="sm:col-span-2"
                  />
                  <TextField
                    label="Quantity"
                    name="quantity"
                    inputMode="decimal"
                    autoComplete="off"
                    pattern={QUANTITY_PATTERN}
                    required
                  />
                  <TextField
                    label={`Unit cost (${ctx.tenant.currency})`}
                    name="unitCost"
                    inputMode="decimal"
                    autoComplete="off"
                    pattern={MONEY_PATTERN}
                  />
                  <div className="sm:col-span-4">
                    <SubmitButton variant="secondary" pendingLabel="Adding…">
                      Add line
                    </SubmitButton>
                  </div>
                </form>
              )}
            </Card>
          )}

          {canEdit && choices && (
            <Card aria-labelledby="purchase-heading">
              <SectionHeading id="purchase-heading">Details</SectionHeading>
              <form action={updatePurchaseAction} className="space-y-4">
                <TenantField slug={ctx.tenant.slug} />
                <input type="hidden" name="purchaseId" value={purchase.id} />
                <PurchaseFields
                  suppliers={choices.suppliers}
                  locations={choices.locations}
                  purchase={purchase}
                />
                <SubmitButton variant="secondary" pendingLabel="Saving…">
                  Save details
                </SubmitButton>
              </form>
            </Card>
          )}
        </div>

        <div className="space-y-8">
          <Card aria-labelledby="summary-heading">
            <SectionHeading id="summary-heading">Summary</SectionHeading>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Status</dt>
              <dd>
                <PurchaseStatusBadge status={purchase.status} />
              </dd>
              <dt className="text-muted">Supplier</dt>
              <dd>
                {purchase.supplier && (
                  <Link
                    href={ctx.path(`/inventory/suppliers/${purchase.supplier.id}`)}
                    className="underline"
                  >
                    {purchase.supplier.name}
                  </Link>
                )}
              </dd>
              <dt className="text-muted">Deliver to</dt>
              <dd>{purchase.location?.name}</dd>
              {purchase.received_at && (
                <>
                  <dt className="text-muted">Received</dt>
                  <dd>
                    <DateTime value={purchase.received_at} tenant={ctx.tenant} />
                  </dd>
                </>
              )}
              {!draft && purchase.notes && (
                <>
                  <dt className="text-muted">Notes</dt>
                  <dd className="whitespace-pre-line">{purchase.notes}</dd>
                </>
              )}
            </dl>
          </Card>
          {canEdit && (
            <Card aria-labelledby="receive-heading">
              <SectionHeading id="receive-heading">Receive</SectionHeading>
              <p className="mb-3 text-sm text-muted">
                Adds every line to stock at {purchase.location?.name}. A received purchase can't be
                changed.
              </p>
              <form action={receivePurchaseAction} className="space-y-4">
                <TenantField slug={ctx.tenant.slug} />
                <input type="hidden" name="purchaseId" value={purchase.id} />
                <Checkbox
                  label="Update item costs"
                  name="updateCosts"
                  defaultChecked
                  description="Set each item's cost to the price paid here."
                />
                <SubmitButton pendingLabel="Receiving…">Receive into stock</SubmitButton>
              </form>
              <form action={deletePurchaseAction} className="mt-4">
                <TenantField slug={ctx.tenant.slug} />
                <input type="hidden" name="purchaseId" value={purchase.id} />
                <ConfirmSubmit message="Delete this draft purchase?" variant="ghost">
                  Delete draft
                </ConfirmSubmit>
              </form>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- ledger

/** The stock ledger, newest first. ?item= narrows to one item. */
export async function MovementsPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.view);
  const itemParam = param(searchParams, 'item');
  const item = UUID.test(itemParam) ? await getItem(ctx.db, itemParam) : null;
  const rows = await listMovements(ctx.db, ctx.tenant.id, { itemId: item?.id, limit: 200 });
  return (
    <>
      {inventoryHeader(ctx, item ? `Movements: ${item.name}` : 'Stock movements', {
        current: 'movements',
        description: 'Every change to stock, newest first. Movements are never edited.',
      })}
      {flash(searchParams)}
      <MovementsTable rows={rows} ctx={ctx} caption="Stock movements" showItem={!item} />
    </>
  );
}

async function ledgerChoices(ctx: TenantContext) {
  const [items, locations] = await Promise.all([
    itemOptions(ctx.db, ctx.tenant.id, { trackedOnly: true }),
    listLocations(ctx.db, ctx.tenant.id, { activeOnly: true }),
  ]);
  return { items, locations: locations.map((l) => ({ value: l.id, label: l.name })) };
}

function itemDefault(searchParams: TenantPageProps['searchParams'], items: { value: string }[]) {
  const item = param(searchParams, 'item');
  return items.some((i) => i.value === item) ? item : '';
}

export async function AdjustStockPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.adjust);
  const { items, locations } = await ledgerChoices(ctx);
  return (
    <>
      {inventoryHeader(ctx, 'Adjust stock', {
        description: 'Correct a count, or write off breakage and waste.',
      })}
      {flash(searchParams)}
      <Card aria-labelledby="adjust-heading" className="max-w-2xl">
        <SectionHeading id="adjust-heading">Adjustment</SectionHeading>
        <form action={adjustStockAction} className="space-y-4">
          <TenantField slug={ctx.tenant.slug} />
          <SelectField
            label="Item"
            name="itemId"
            options={items}
            placeholder="Choose an item"
            defaultValue={itemDefault(searchParams, items)}
            required
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Location" name="locationId" options={locations} required />
            <TextField
              label="Change"
              name="quantity"
              inputMode="decimal"
              autoComplete="off"
              pattern={QUANTITY_PATTERN}
              required
              hint="Positive adds (5), negative removes (-2)"
            />
          </div>
          <TextField
            label="Reason"
            name="reason"
            required
            maxLength={200}
            autoComplete="off"
            hint="e.g. Stock count, Broken, Expired"
          />
          <SubmitButton pendingLabel="Saving…">Adjust stock</SubmitButton>
        </form>
      </Card>
    </>
  );
}

export async function TransferStockPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.transfer);
  const { items, locations } = await ledgerChoices(ctx);
  return (
    <>
      {inventoryHeader(ctx, 'Move stock', {
        description: 'Move stock between locations, e.g. from the store to the bar.',
      })}
      {flash(searchParams)}
      {locations.length < 2 ? (
        <EmptyState
          title="Add a second location first"
          action={
            ctx.can(P.manage) ? (
              <Link href={ctx.path('/inventory/locations')} className={buttonClass('primary')}>
                Locations
              </Link>
            ) : undefined
          }
        />
      ) : (
        <Card aria-labelledby="transfer-heading" className="max-w-2xl">
          <SectionHeading id="transfer-heading">Transfer</SectionHeading>
          <form action={transferStockAction} className="space-y-4">
            <TenantField slug={ctx.tenant.slug} />
            <SelectField
              label="Item"
              name="itemId"
              options={items}
              placeholder="Choose an item"
              defaultValue={itemDefault(searchParams, items)}
              required
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField
                label="From"
                name="from"
                options={locations}
                defaultValue={locations[0]!.value}
                required
              />
              <SelectField
                label="To"
                name="to"
                options={locations}
                defaultValue={locations[1]!.value}
                required
              />
              <TextField
                label="Quantity"
                name="quantity"
                inputMode="decimal"
                autoComplete="off"
                pattern={QUANTITY_PATTERN}
                required
              />
            </div>
            <TextField label="Note" name="note" maxLength={200} autoComplete="off" />
            <SubmitButton pendingLabel="Moving…">Move stock</SubmitButton>
          </form>
        </Card>
      )}
    </>
  );
}
