import { KittoError, unwrap, type KittoClient, type Tables, type TablesInsert } from '@kitto/core';
import { orderInvoiceLines, type InvoiceLineSuggestion } from './math';
import type { OrderFormInput } from './schemas';
import type { OrderStatus } from './status';

export type Order = Tables<'orders'>;
export type OrderLine = Tables<'order_lines'>;

export type OrderRow = Order & {
  customer: { id: string; name: string } | null;
  location: { id: string; name: string } | null;
  reservation: {
    id: string;
    title: string;
    starts_at: string | null;
    status: string;
    resource: { name: string } | null;
  } | null;
};

export type OrderLineRow = OrderLine & {
  item: { id: string; name: string; unit: string; track_stock: boolean } | null;
};

const ORDER_SELECT =
  '*, customer:customers(id, name), location:stock_locations(id, name), reservation:reservations(id, title, starts_at, status, resource:resources(name))' as const;

export interface OrderQuery {
  statuses?: readonly OrderStatus[] | undefined;
  customerId?: string | undefined;
  reservationId?: string | undefined;
  limit?: number;
}

export async function listOrders(
  db: KittoClient,
  tenantId: string,
  q: OrderQuery = {},
): Promise<OrderRow[]> {
  let req = db.from('orders').select(ORDER_SELECT).eq('tenant_id', tenantId);
  if (q.statuses) req = req.in('status', [...q.statuses]);
  if (q.customerId) req = req.eq('customer_id', q.customerId);
  if (q.reservationId) req = req.eq('reservation_id', q.reservationId);
  const rows = unwrap(await req.order('created_at', { ascending: false }).limit(q.limit ?? 200));
  return rows as unknown as OrderRow[];
}

export async function getOrder(db: KittoClient, id: string): Promise<OrderRow | null> {
  const res = await db.from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle();
  if (res.error) throw new KittoError(res.error.message, res.error.code);
  return res.data as unknown as OrderRow | null;
}

export async function listOrderLines(db: KittoClient, orderId: string): Promise<OrderLineRow[]> {
  const rows = unwrap(
    await db
      .from('order_lines')
      .select('*, item:items(id, name, unit, track_stock)')
      .eq('order_id', orderId)
      .order('position'),
  );
  return rows as OrderLineRow[];
}

const orderRow = (input: OrderFormInput) => ({
  channel: input.channel,
  customer_id: input.customerId,
  reservation_id: input.reservationId,
  notes: input.notes,
  // null: the database picks the tenant's default location.
  ...(input.locationId && { location_id: input.locationId }),
});

export async function createOrder(
  db: KittoClient,
  tenantId: string,
  input: OrderFormInput,
): Promise<Order> {
  return unwrap(
    await db
      .from('orders')
      // number (and location_id when not chosen) are filled in by the database.
      .insert({ tenant_id: tenantId, ...orderRow(input) } as TablesInsert<'orders'>)
      .select()
      .single(),
  );
}

export async function updateOrder(
  db: KittoClient,
  id: string,
  input: OrderFormInput,
): Promise<Order> {
  return unwrap(await db.from('orders').update(orderRow(input)).eq('id', id).select().single());
}

export interface OrderLineInput {
  itemId: string | null;
  description: string;
  quantity: number;
  /** null: use the item's price. */
  unitPriceMinor: number | null;
  note: string;
}

export async function addOrderLine(
  db: KittoClient,
  tenantId: string,
  orderId: string,
  input: OrderLineInput,
  position: number,
): Promise<void> {
  unwrap(
    await db
      .from('order_lines')
      .insert({
        tenant_id: tenantId,
        order_id: orderId,
        item_id: input.itemId,
        description: input.description,
        quantity: input.quantity,
        // The guard trigger fills a missing price (and name) from the item.
        unit_price_minor: input.unitPriceMinor as number,
        note: input.note,
        position,
      })
      .select('id'),
  );
}

export async function removeOrderLine(db: KittoClient, lineId: string): Promise<void> {
  const rows = unwrap(await db.from('order_lines').delete().eq('id', lineId).select('id'));
  if (rows.length === 0) throw new KittoError('Permission denied', '42501');
}

/** Move an order along its status machine (stock moves in the same transaction). */
export async function setOrderStatus(
  db: KittoClient,
  id: string,
  status: OrderStatus,
  reason?: string,
): Promise<Order> {
  return unwrap(
    await db
      .rpc('set_order_status', {
        p_order_id: id,
        p_status: status,
        ...(reason !== undefined && { p_reason: reason }),
      })
      .single(),
  ) as Order;
}

/**
 * Reservations an order can be charged to: not cancelled and not long over.
 * Reads booking's table directly (RLS applies), so orders doesn't depend on
 * the booking package.
 */
export async function reservationChoices(db: KittoClient, tenantId: string) {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const rows = unwrap(
    await db
      .from('reservations')
      .select('id, title, starts_at, ends_at, status, resource:resources(name)')
      .eq('tenant_id', tenantId)
      .in('status', ['tentative', 'confirmed', 'checked_in'])
      .gte('ends_at', since)
      .order('starts_at')
      .limit(200),
  );
  return rows as unknown as {
    id: string;
    title: string;
    starts_at: string | null;
    ends_at: string | null;
    status: string;
    resource: { name: string } | null;
  }[];
}

/**
 * Invoice lines for the orders charged to a reservation that are ready to
 * bill (sent or fulfilled, not yet on an invoice). Creating the reservation's
 * invoice links exactly these orders to it.
 */
export async function reservationOrderInvoiceLines(
  db: KittoClient,
  tenantId: string,
  reservationId: string,
): Promise<InvoiceLineSuggestion[]> {
  const orders = unwrap(
    await db
      .from('orders')
      .select('id, number, order_lines(description, quantity, unit_price_minor, note, position)')
      .eq('tenant_id', tenantId)
      .eq('reservation_id', reservationId)
      .in('status', ['sent', 'fulfilled'])
      .is('invoice_id', null)
      .order('number'),
  );
  return orders.flatMap((o) =>
    orderInvoiceLines(
      [...o.order_lines].sort((a, b) => a.position - b.position),
      `Order #${o.number} · `,
    ),
  );
}
