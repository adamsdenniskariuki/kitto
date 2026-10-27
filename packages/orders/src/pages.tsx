import 'server-only';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { flashMessages, formatDate } from '@kitto/core';
import {
  param,
  requirePermission,
  type TenantContext,
  type TenantPageProps,
} from '@kitto/auth/server';
import { CUSTOMER_PERMISSIONS, customerOptions } from '@kitto/customers';
import { formatQuantity, itemOptions, listLocations } from '@kitto/inventory';
import { InventoryLiveRefresh } from '@kitto/inventory/client';
import {
  Badge,
  Card,
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
  addOrderLineAction,
  createOrderAction,
  removeOrderLineAction,
  setOrderStatusAction,
  updateOrderAction,
} from './actions';
import {
  getOrder,
  listOrderLines,
  listOrders,
  reservationChoices,
  type OrderLineRow,
  type OrderRow,
} from './data';
import { ORDER_PERMISSIONS as P } from './permissions';
import { ORDER_ERRORS, ORDER_NOTICES } from './shared';
import {
  ACTIVE_STATUSES,
  consumesStock,
  isFinal,
  isOrderStatus,
  nextStatuses,
  ORDER_STATUS_ACTIONS,
  ORDER_STATUS_LABELS,
  ORDER_STATUS_TONES,
  ORDER_STATUSES,
  type OrderStatus,
} from './status';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUANTITY_PATTERN = '[0-9,]+(\\.[0-9]{1,3})?';
const MONEY_PATTERN = '[0-9,]+(\\.[0-9]{1,3})?';

function flash(searchParams: TenantPageProps['searchParams']) {
  return <Flash {...flashMessages(searchParams, ORDER_NOTICES, ORDER_ERRORS)} />;
}

export function OrderStatusBadge({ status }: { status: string }) {
  return isOrderStatus(status) ? (
    <Badge tone={ORDER_STATUS_TONES[status]}>{ORDER_STATUS_LABELS[status]}</Badge>
  ) : (
    <Badge>{status}</Badge>
  );
}

const orderTitle = (o: { number: number; channel: string }) =>
  `Order #${o.number}${o.channel ? ` · ${o.channel}` : ''}`;

function ordersHeader(
  ctx: TenantContext,
  title: string,
  description?: string,
  actions?: ReactNode,
) {
  return (
    <PageHeader
      eyebrow={
        title === 'Orders' ? undefined : (
          <Link href={ctx.path('/orders')} className="hover:underline">
            Orders
          </Link>
        )
      }
      title={title}
      description={description}
      actions={actions}
    />
  );
}

function reservationLabel(
  r: { title: string; starts_at: string | null; resource?: { name: string } | null },
  ctx: TenantContext,
) {
  const when = r.starts_at
    ? formatDate(r.starts_at, ctx.tenant, { day: 'numeric', month: 'short', timeStyle: undefined })
    : '';
  return [r.resource?.name, r.title, when].filter(Boolean).join(' · ') || 'Reservation';
}

function OrdersTable({
  rows,
  ctx,
  caption,
  showCustomer = true,
}: {
  rows: OrderRow[];
  ctx: TenantContext;
  caption: string;
  showCustomer?: boolean;
}) {
  return (
    <DataTable
      caption={caption}
      hideCaption
      rows={rows}
      rowKey={(o) => o.id}
      empty={<EmptyState title="No orders" />}
      columns={[
        {
          key: 'number',
          header: 'Order',
          rowHeader: true,
          cell: (o) => (
            <Link href={ctx.path(`/orders/${o.id}`)} className="underline">
              {orderTitle(o)}
            </Link>
          ),
        },
        { key: 'status', header: 'Status', cell: (o) => <OrderStatusBadge status={o.status} /> },
        ...(showCustomer
          ? [
              {
                key: 'customer',
                header: 'Customer',
                hideOnMobile: true,
                cell: (o: OrderRow) => o.customer?.name ?? '',
              },
            ]
          : []),
        {
          key: 'opened',
          header: 'Opened',
          hideOnMobile: true,
          cell: (o) => <DateTime value={o.created_at} tenant={ctx.tenant} />,
        },
        {
          key: 'total',
          header: 'Total',
          align: 'right',
          cell: (o) => <Money minor={o.total_minor} tenant={ctx.tenant} />,
        },
      ]}
    />
  );
}

// ------------------------------------------------------------------- list

type Filter = 'active' | OrderStatus | 'all';
const FILTERS: [Filter, string][] = [
  ['active', 'In progress'],
  ...ORDER_STATUSES.map((s): [Filter, string] => [s, ORDER_STATUS_LABELS[s]]),
  ['all', 'All'],
];

/** Orders, newest first; ?status= filters (default: in progress). Refreshes live. */
export async function OrdersPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.view);
  const statusParam = param(searchParams, 'status');
  const filter: Filter = FILTERS.some(([f]) => f === statusParam)
    ? (statusParam as Filter)
    : 'active';
  const statuses = filter === 'all' ? undefined : filter === 'active' ? ACTIVE_STATUSES : [filter];
  const orders = await listOrders(ctx.db, ctx.tenant.id, { statuses });
  return (
    <>
      <InventoryLiveRefresh tenantId={ctx.tenant.id} table="orders" />
      {ordersHeader(
        ctx,
        'Orders',
        'Tables, tabs and counter sales. Sending an order takes its stock.',
        ctx.can(P.create) ? (
          <Link href={ctx.path('/orders/new')} className={buttonClass('primary')}>
            New order
          </Link>
        ) : undefined,
      )}
      {flash(searchParams)}
      <nav aria-label="Order status" className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map(([f, label]) => (
          <Link
            key={f}
            href={ctx.path(f === 'active' ? '/orders' : `/orders?status=${f}`)}
            className={buttonClass(f === filter ? 'primary' : 'secondary', 'sm')}
            aria-current={f === filter ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      <OrdersTable rows={orders} ctx={ctx} caption="Orders" />
    </>
  );
}

// -------------------------------------------------------------- new order

async function orderChoices(ctx: TenantContext) {
  const [customers, reservations, locations] = await Promise.all([
    ctx.can(CUSTOMER_PERMISSIONS.view)
      ? customerOptions(ctx.db, ctx.tenant.id)
      : Promise.resolve([]),
    reservationChoices(ctx.db, ctx.tenant.id),
    listLocations(ctx.db, ctx.tenant.id, { activeOnly: true }),
  ]);
  return {
    customers,
    reservations: reservations.map((r) => ({ value: r.id, label: reservationLabel(r, ctx) })),
    locations: locations.map((l) => ({ value: l.id, label: l.name })),
  };
}

function OrderFields({
  choices,
  order,
  defaults = {},
}: {
  choices: Awaited<ReturnType<typeof orderChoices>>;
  order?: OrderRow;
  defaults?: { customerId?: string; reservationId?: string };
}) {
  const open = !order || order.status === 'open';
  return (
    <>
      <TextField
        label="Table or label"
        name="channel"
        maxLength={60}
        autoComplete="off"
        hint="e.g. Table 4, Bar, Counter, Job 1182"
        defaultValue={order?.channel}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {choices.customers.length > 0 ? (
          <SelectField
            label="Customer"
            name="customerId"
            placeholder="No customer"
            options={choices.customers}
            defaultValue={order ? (order.customer_id ?? '') : (defaults.customerId ?? '')}
          />
        ) : (
          <input type="hidden" name="customerId" value={order?.customer_id ?? ''} />
        )}
        {choices.reservations.length > 0 ? (
          <SelectField
            label="Charge to reservation"
            name="reservationId"
            placeholder="Not charged to a booking"
            options={choices.reservations}
            defaultValue={order ? (order.reservation_id ?? '') : (defaults.reservationId ?? '')}
          />
        ) : (
          <input type="hidden" name="reservationId" value={order?.reservation_id ?? ''} />
        )}
      </div>
      {open && choices.locations.length > 1 ? (
        <SelectField
          label="Take stock from"
          name="locationId"
          options={choices.locations}
          defaultValue={order?.location_id ?? choices.locations[0]?.value}
        />
      ) : (
        <input type="hidden" name="locationId" value={order?.location_id ?? ''} />
      )}
      <TextareaField
        label="Notes"
        name="notes"
        rows={2}
        maxLength={2000}
        defaultValue={order?.notes}
      />
    </>
  );
}

/** Opens an order; ?reservation= charges it to a booking, ?customer= picks the customer. */
export async function NewOrderPage({ ctx, searchParams }: TenantPageProps) {
  requirePermission(ctx, P.create);
  const choices = await orderChoices(ctx);
  const reservation = param(searchParams, 'reservation');
  const customer = param(searchParams, 'customer');
  if (UUID.test(reservation) && !choices.reservations.some((r) => r.value === reservation)) {
    // Keep a reservation outside the usual window selectable when linked to directly.
    const res = await ctx.db
      .from('reservations')
      .select('id, title, starts_at, status, resource:resources(name)')
      .eq('id', reservation)
      .eq('tenant_id', ctx.tenant.id)
      .not('status', 'in', '(cancelled,no_show)')
      .maybeSingle();
    if (res.data)
      choices.reservations.unshift({
        value: res.data.id,
        label: reservationLabel(res.data as Parameters<typeof reservationLabel>[0], ctx),
      });
  }
  return (
    <>
      {ordersHeader(ctx, 'New order')}
      {flash(searchParams)}
      <Card aria-labelledby="order-heading" className="max-w-2xl">
        <SectionHeading id="order-heading">Order</SectionHeading>
        <form action={createOrderAction} className="space-y-4">
          <TenantField slug={ctx.tenant.slug} />
          <OrderFields
            choices={choices}
            defaults={{
              ...(UUID.test(customer) && { customerId: customer }),
              ...(UUID.test(reservation) && { reservationId: reservation }),
            }}
          />
          <SubmitButton pendingLabel="Opening…">Open order</SubmitButton>
        </form>
      </Card>
    </>
  );
}

// ----------------------------------------------------------------- detail

export interface OrderDetailPageProps extends TenantPageProps {
  orderId: string;
  /** Extra sections from other modules (e.g. billing). Each gets the loaded order and lines. */
  sections?: ((order: OrderRow, lines: OrderLineRow[]) => ReactNode)[];
  /** Where the order's invoice lives in the app, if it has one (billing is optional). */
  invoiceHref?: (invoiceId: string) => string | null;
  /** Where a reservation lives in the app (booking is optional). */
  reservationHref?: (reservationId: string) => string | null;
}

export async function OrderDetailPage({
  ctx,
  searchParams,
  orderId,
  sections = [],
  invoiceHref = () => null,
  reservationHref = () => null,
}: OrderDetailPageProps) {
  requirePermission(ctx, P.view);
  if (!UUID.test(orderId)) notFound();
  const order = await getOrder(ctx.db, orderId);
  if (!order || order.tenant_id !== ctx.tenant.id) notFound();
  const open = order.status === 'open';
  const canEditLines = open && ctx.can(P.create);
  const canEditDetails = !isFinal(order.status) && ctx.can(P.create);
  const [lines, items, choices] = await Promise.all([
    listOrderLines(ctx.db, order.id),
    canEditLines ? itemOptions(ctx.db, ctx.tenant.id) : Promise.resolve([]),
    canEditDetails ? orderChoices(ctx) : Promise.resolve(null),
  ]);
  // Keep the current customer / reservation selectable even if no longer offered.
  if (choices && order.customer && !choices.customers.some((c) => c.value === order.customer_id))
    choices.customers.unshift({ value: order.customer.id, label: order.customer.name });
  if (
    choices &&
    order.reservation &&
    !choices.reservations.some((r) => r.value === order.reservation_id)
  )
    choices.reservations.unshift({
      value: order.reservation.id,
      label: reservationLabel(order.reservation, ctx),
    });
  const next = nextStatuses(order, ctx.can);
  const invoiceLink = order.invoice_id ? invoiceHref(order.invoice_id) : null;
  const reservationLink = order.reservation_id ? reservationHref(order.reservation_id) : null;

  return (
    <>
      <InventoryLiveRefresh tenantId={ctx.tenant.id} table="orders" />
      {ordersHeader(ctx, orderTitle(order))}
      {flash(searchParams)}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="lines-heading">
            <SectionHeading id="lines-heading">Lines</SectionHeading>
            <DataTable
              caption="Order lines"
              hideCaption
              rows={lines}
              rowKey={(l) => l.id}
              empty={<EmptyState title="No lines yet">Add what was ordered below.</EmptyState>}
              columns={[
                {
                  key: 'description',
                  header: 'Item',
                  rowHeader: true,
                  cell: (l) => (
                    <span>
                      {l.description}
                      {l.note && <span className="block text-sm text-muted">{l.note}</span>}
                    </span>
                  ),
                },
                {
                  key: 'qty',
                  header: 'Qty',
                  align: 'right',
                  cell: (l) =>
                    `${formatQuantity(l.quantity, ctx.tenant.locale)}${l.item && l.item.unit !== 'each' ? ` ${l.item.unit}` : ''}`,
                },
                {
                  key: 'price',
                  header: 'Price',
                  align: 'right',
                  hideOnMobile: true,
                  cell: (l) => <Money minor={l.unit_price_minor} tenant={ctx.tenant} />,
                },
                {
                  key: 'total',
                  header: 'Total',
                  align: 'right',
                  cell: (l) => <Money minor={l.line_total_minor ?? 0} tenant={ctx.tenant} />,
                },
                ...(canEditLines
                  ? [
                      {
                        key: 'remove',
                        header: <span className="sr-only">Remove</span>,
                        align: 'right' as const,
                        cell: (l: OrderLineRow) => (
                          <form action={removeOrderLineAction}>
                            <TenantField slug={ctx.tenant.slug} />
                            <input type="hidden" name="orderId" value={order.id} />
                            <input type="hidden" name="lineId" value={l.id} />
                            <SubmitButton size="sm" variant="ghost">
                              Remove<span className="sr-only"> {l.description}</span>
                            </SubmitButton>
                          </form>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
            <p className="mt-3 text-right font-semibold" data-testid="order-total">
              Total <Money minor={order.total_minor} tenant={ctx.tenant} />
            </p>
          </section>

          {canEditLines && (
            <Card aria-labelledby="add-line-heading">
              <SectionHeading id="add-line-heading">Add a line</SectionHeading>
              <form action={addOrderLineAction} className="grid gap-4 sm:grid-cols-6">
                <TenantField slug={ctx.tenant.slug} />
                <input type="hidden" name="orderId" value={order.id} />
                {items.length > 0 && (
                  <SelectField
                    label="Item"
                    name="itemId"
                    options={items}
                    placeholder="Free text (no item)"
                    wrapperClassName="sm:col-span-3"
                  />
                )}
                <TextField
                  label="Description"
                  name="description"
                  maxLength={200}
                  autoComplete="off"
                  hint={items.length > 0 ? "Leave blank to use the item's name" : undefined}
                  wrapperClassName={items.length > 0 ? 'sm:col-span-3' : 'sm:col-span-6'}
                />
                <TextField
                  label="Quantity"
                  name="quantity"
                  inputMode="decimal"
                  autoComplete="off"
                  pattern={QUANTITY_PATTERN}
                  defaultValue="1"
                  required
                  wrapperClassName="sm:col-span-2"
                />
                <TextField
                  label={`Unit price (${ctx.tenant.currency})`}
                  name="unitPrice"
                  inputMode="decimal"
                  autoComplete="off"
                  pattern={MONEY_PATTERN}
                  hint={items.length > 0 ? "Blank uses the item's price" : undefined}
                  wrapperClassName="sm:col-span-2"
                />
                <TextField
                  label="Note"
                  name="note"
                  maxLength={200}
                  autoComplete="off"
                  hint="e.g. no ice"
                  wrapperClassName="sm:col-span-2"
                />
                <div className="sm:col-span-6">
                  <SubmitButton variant="secondary" pendingLabel="Adding…">
                    Add line
                  </SubmitButton>
                </div>
              </form>
            </Card>
          )}

          {canEditDetails && choices && (
            <Card aria-labelledby="details-heading">
              <SectionHeading id="details-heading">Details</SectionHeading>
              <form action={updateOrderAction} className="space-y-4">
                <TenantField slug={ctx.tenant.slug} />
                <input type="hidden" name="orderId" value={order.id} />
                <OrderFields choices={choices} order={order} />
                <SubmitButton variant="secondary" pendingLabel="Saving…">
                  Save details
                </SubmitButton>
              </form>
            </Card>
          )}

          {sections.map((render, i) => (
            <div key={i}>{render(order, lines)}</div>
          ))}
        </div>

        <div className="space-y-8">
          <Card aria-labelledby="summary-heading">
            <SectionHeading id="summary-heading">Summary</SectionHeading>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Status</dt>
              <dd>
                <OrderStatusBadge status={order.status} />
              </dd>
              <dt className="text-muted">Stock from</dt>
              <dd>{order.location?.name}</dd>
              <dt className="text-muted">Customer</dt>
              <dd>
                {order.customer ? (
                  ctx.can(CUSTOMER_PERMISSIONS.view) ? (
                    <Link href={ctx.path(`/customers/${order.customer.id}`)} className="underline">
                      {order.customer.name}
                    </Link>
                  ) : (
                    order.customer.name
                  )
                ) : (
                  '—'
                )}
              </dd>
              {order.reservation_id && (
                <>
                  <dt className="text-muted">Charged to</dt>
                  <dd>
                    {reservationLink ? (
                      <Link href={ctx.path(reservationLink)} className="underline">
                        {order.reservation
                          ? reservationLabel(order.reservation, ctx)
                          : 'Reservation'}
                      </Link>
                    ) : order.reservation ? (
                      reservationLabel(order.reservation, ctx)
                    ) : (
                      'A reservation'
                    )}
                  </dd>
                </>
              )}
              {order.invoice_id && (
                <>
                  <dt className="text-muted">Billed on</dt>
                  <dd>
                    {invoiceLink ? (
                      <Link href={ctx.path(invoiceLink)} className="underline">
                        Invoice
                      </Link>
                    ) : (
                      'An invoice'
                    )}
                  </dd>
                </>
              )}
              <dt className="text-muted">Opened</dt>
              <dd>
                <DateTime value={order.created_at} tenant={ctx.tenant} />
              </dd>
              {order.sent_at && (
                <>
                  <dt className="text-muted">Sent</dt>
                  <dd>
                    <DateTime value={order.sent_at} tenant={ctx.tenant} />
                  </dd>
                </>
              )}
              {order.paid_at && (
                <>
                  <dt className="text-muted">Paid</dt>
                  <dd>
                    <DateTime value={order.paid_at} tenant={ctx.tenant} />
                  </dd>
                </>
              )}
              {order.cancelled_at && (
                <>
                  <dt className="text-muted">Cancelled</dt>
                  <dd>
                    <DateTime value={order.cancelled_at} tenant={ctx.tenant} />
                    {order.cancel_reason && (
                      <span className="block text-muted">{order.cancel_reason}</span>
                    )}
                  </dd>
                </>
              )}
              {!canEditDetails && order.notes && (
                <>
                  <dt className="text-muted">Notes</dt>
                  <dd className="whitespace-pre-line">{order.notes}</dd>
                </>
              )}
            </dl>
          </Card>

          {next.length > 0 && (
            <Card aria-labelledby="status-heading">
              <SectionHeading id="status-heading">Next step</SectionHeading>
              {open && next.includes('sent') && (
                <p className="mb-3 text-sm text-muted">
                  Sending takes the stock for these lines from {order.location?.name}.
                </p>
              )}
              <div className="space-y-4">
                {next
                  .filter((s) => s !== 'cancelled')
                  .map((s, i) => (
                    <form key={s} action={setOrderStatusAction}>
                      <TenantField slug={ctx.tenant.slug} />
                      <input type="hidden" name="orderId" value={order.id} />
                      <input type="hidden" name="status" value={s} />
                      <SubmitButton variant={i === 0 ? 'primary' : 'secondary'}>
                        {ORDER_STATUS_ACTIONS[s]}
                      </SubmitButton>
                    </form>
                  ))}
                {next.includes('cancelled') && (
                  <form action={setOrderStatusAction} className="space-y-3">
                    <TenantField slug={ctx.tenant.slug} />
                    <input type="hidden" name="orderId" value={order.id} />
                    <input type="hidden" name="status" value="cancelled" />
                    <TextField
                      label="Reason for cancelling"
                      name="reason"
                      maxLength={500}
                      autoComplete="off"
                      hint={consumesStock(order.status) ? 'Its stock is returned.' : undefined}
                    />
                    <ConfirmSubmit message="Cancel this order? This cannot be undone.">
                      {ORDER_STATUS_ACTIONS.cancelled}
                    </ConfirmSubmit>
                  </form>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------- sections for other modules

/**
 * Orders charged to a reservation, for the reservation's page. Booking
 * doesn't depend on orders: the app composes this in.
 */
export async function ReservationOrders({
  ctx,
  reservationId,
  canAdd = true,
}: {
  ctx: TenantContext;
  reservationId: string;
  /** False for reservations that can no longer take charges (cancelled...). */
  canAdd?: boolean;
}) {
  if (!ctx.can(P.view)) return null;
  const orders = await listOrders(ctx.db, ctx.tenant.id, { reservationId, limit: 50 });
  const charged = orders.filter((o) => o.status !== 'cancelled');
  const unbilled = charged.filter((o) => o.invoice_id === null);
  const total = charged.reduce((sum, o) => sum + o.total_minor, 0);
  return (
    <Card aria-labelledby="reservation-orders-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading id="reservation-orders-heading">Orders</SectionHeading>
        {canAdd && ctx.can(P.create) && (
          <Link
            href={ctx.path(`/orders/new?reservation=${reservationId}`)}
            className="text-sm underline-offset-2 hover:underline"
          >
            Charge an order to this reservation
          </Link>
        )}
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-muted">No orders charged to this reservation.</p>
      ) : (
        <>
          <OrdersTable rows={orders} ctx={ctx} caption="Orders charged" showCustomer={false} />
          <p className="mt-3 text-sm" data-testid="reservation-orders-total">
            Charged: <Money minor={total} tenant={ctx.tenant} />
            {unbilled.length > 0 && unbilled.length < charged.length && (
              <span className="text-muted"> ({unbilled.length} not yet on an invoice)</span>
            )}
          </p>
        </>
      )}
    </Card>
  );
}

/** A customer's recent orders, for the customer's page. */
export async function CustomerOrders({
  ctx,
  customerId,
}: {
  ctx: TenantContext;
  customerId: string;
}) {
  if (!ctx.can(P.view)) return null;
  const orders = await listOrders(ctx.db, ctx.tenant.id, { customerId, limit: 20 });
  return (
    <Card aria-labelledby="customer-orders-heading">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading id="customer-orders-heading">Orders</SectionHeading>
        {ctx.can(P.create) && (
          <Link
            href={ctx.path(`/orders/new?customer=${customerId}`)}
            className="text-sm underline-offset-2 hover:underline"
          >
            New order for this customer
          </Link>
        )}
      </div>
      {orders.length === 0 ? (
        <p className="text-sm text-muted">No orders yet.</p>
      ) : (
        <OrdersTable rows={orders} ctx={ctx} caption="Customer orders" showCustomer={false} />
      )}
    </Card>
  );
}
