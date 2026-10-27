import type { TenantContext } from '@kitto/auth/server';
import {
  BILLING_PERMISSIONS,
  draftInvoiceForSource,
  issueInvoice,
  recordPayment,
} from '@kitto/billing';
import {
  addResourceHours,
  BOOKING_PERMISSIONS,
  createRecurringReservations,
  createReservation,
  createResource,
} from '@kitto/booking';
import { addDays, todayIn, toMinorUnits } from '@kitto/core';
import { createCustomer, CUSTOMER_PERMISSIONS } from '@kitto/customers';
import {
  addPurchaseLine,
  createItem,
  createPurchase,
  createSupplier,
  INVENTORY_PERMISSIONS,
  listLocations,
  receivePurchase,
  type ItemInput,
} from '@kitto/inventory';
import {
  addOrderLine,
  createOrder,
  ORDER_PERMISSIONS,
  reservationOrderInvoiceLines,
  setOrderStatus,
} from '@kitto/orders';

/*
 * Demo-only sample data. It goes through the modules' own data functions, so
 * RLS, triggers and SQL rules apply exactly as they do for the forms: prices
 * come from resource rates, stock from a received purchase, the invoice number
 * from the gapless counter. The framework packages contain no demo data.
 */

/** Everything loading sample data touches. Owners hold all of these. */
export const SAMPLE_DATA_PERMISSIONS = [
  'tenant.manage',
  CUSTOMER_PERMISSIONS.create,
  BOOKING_PERMISSIONS.configure,
  BOOKING_PERMISSIONS.create,
  INVENTORY_PERMISSIONS.manage,
  INVENTORY_PERMISSIONS.purchase,
  ORDER_PERMISSIONS.create,
  ORDER_PERMISSIONS.serve,
  ORDER_PERMISSIONS.bill,
  BILLING_PERMISSIONS.create,
  BILLING_PERMISSIONS.issue,
  BILLING_PERMISSIONS.record,
] as const;

export const canLoadSampleData = (ctx: TenantContext) =>
  SAMPLE_DATA_PERMISSIONS.every((p) => ctx.can(p));

/** True while the workspace has no customers, resources or items. */
export async function isEmptyWorkspace(ctx: TenantContext): Promise<boolean> {
  const counts = await Promise.all(
    (['customers', 'resources', 'items'] as const).map(async (table) => {
      const { count, error } = await ctx.db
        .from(table)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', ctx.tenant.id);
      return error ? 1 : (count ?? 1);
    }),
  );
  return counts.every((n) => n === 0);
}

/** The first Monday to Friday on or after `day` ('YYYY-MM-DD'). */
export function nextWeekday(day: string): string {
  let d = day;
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, 1);
  return d;
}

const item = (input: Partial<ItemInput> & Pick<ItemInput, 'name'>): ItemInput => ({
  sku: null,
  unit: 'each',
  category: '',
  description: '',
  costMinor: null,
  priceMinor: null,
  reorderLevel: 0,
  trackStock: true,
  allowNegative: false,
  active: true,
  ...input,
});

/**
 * A small guest house: three customers, two rooms and a meeting room (weekday
 * hours and a weekly booking), drinks received from a supplier, room service
 * charged to a stay, a walk-in counter sale, and the stay's invoice issued
 * with a cash deposit.
 */
export async function loadSampleData(ctx: TenantContext): Promise<void> {
  const { db, tenant } = ctx;
  const money = (major: number) => toMinorUnits(major, tenant.currency);
  const tomorrow = addDays(todayIn(tenant.timezone), 1);

  const achieng = await createCustomer(db, tenant.id, {
    name: 'Achieng Otieno',
    phone: '+254712345678',
    email: 'achieng@example.com',
    tags: ['returning', 'vip'],
    notes: 'Prefers a quiet room.',
  });
  const brian = await createCustomer(db, tenant.id, {
    name: 'Brian Kamau',
    phone: '+254722000111',
    email: null,
    tags: [],
    notes: '',
  });
  const wanjiru = await createCustomer(db, tenant.id, {
    name: 'Wanjiru Mwangi',
    phone: null,
    email: 'wanjiru@example.com',
    tags: ['corporate'],
    notes: '',
  });

  const room = (name: string, capacity: number, rate: number) =>
    createResource(db, tenant.id, {
      kind: 'room',
      name,
      description: '',
      capacity,
      rateMinor: money(rate),
      rateUnit: 'night',
      active: true,
    });
  const room101 = await room('Room 101', 2, 4500);
  const room102 = await room('Room 102', 3, 6000);
  const meetingRoom = await createResource(db, tenant.id, {
    kind: 'meeting_room',
    name: 'Meeting room',
    description: 'Projector and seating for ten.',
    capacity: 10,
    rateMinor: money(2000),
    rateUnit: 'hour',
    active: true,
  });
  for (const weekday of [1, 2, 3, 4, 5])
    await addResourceHours(db, tenant.id, meetingRoom.id, {
      weekday,
      opens: '08:00',
      closes: '18:00',
    });

  const stay = await createReservation(db, {
    resourceId: room101.id,
    start: `${tomorrow}T14:00`,
    end: `${addDays(tomorrow, 2)}T10:00`,
    customerId: achieng.id,
    guests: 2,
    title: 'Anniversary weekend',
    notes: '',
    status: 'confirmed',
  });
  await createReservation(db, {
    resourceId: room102.id,
    start: `${addDays(tomorrow, 1)}T14:00`,
    end: `${addDays(tomorrow, 4)}T10:00`,
    customerId: brian.id,
    guests: 3,
    title: '',
    notes: 'Arriving late.',
    status: 'tentative',
  });
  await createRecurringReservations(db, {
    resourceId: meetingRoom.id,
    start: `${nextWeekday(tomorrow)}T10:00`,
    durationMinutes: 120,
    every: '1 week',
    occurrences: 4,
    customerId: wanjiru.id,
    guests: 6,
    title: 'Weekly planning',
    notes: '',
  });

  const supplier = await createSupplier(db, tenant.id, {
    name: 'Nairobi Beverages Ltd',
    contactName: 'Peter Njoroge',
    phone: '+254733000222',
    email: null,
    notes: '',
    active: true,
  });
  const drink = (name: string, sku: string, price: number, reorderLevel: number) =>
    createItem(
      db,
      tenant.id,
      item({
        name,
        sku,
        unit: 'bottle',
        category: 'Drinks',
        priceMinor: money(price),
        reorderLevel,
      }),
    );
  const lager = await drink('Tusker lager', 'TUS-500', 300, 12);
  const soda = await drink('Soda', 'SODA-300', 100, 24);
  const water = await drink('Bottled water', 'H2O-500', 80, 12);
  const breakfast = await createItem(
    db,
    tenant.id,
    item({ name: 'Breakfast', category: 'Food', priceMinor: money(800), trackStock: false }),
  );

  const [store] = await listLocations(db, tenant.id, { activeOnly: true });
  if (!store) throw new Error('The workspace has no stock location');
  const purchase = await createPurchase(db, tenant.id, {
    supplierId: supplier.id,
    locationId: store.id,
    reference: 'DN-1001',
    notes: '',
  });
  const delivered = [
    { itemId: lager.id, quantity: 48, unitCostMinor: money(170) },
    { itemId: soda.id, quantity: 48, unitCostMinor: money(45) },
    // Below its reorder level, so the low-stock card has something to show.
    { itemId: water.id, quantity: 6, unitCostMinor: money(40) },
  ];
  for (const [position, line] of delivered.entries())
    await addPurchaseLine(db, tenant.id, purchase.id, { ...line, position });
  await receivePurchase(db, purchase.id);

  // Room service charged to the stay: sending it takes the stock.
  const roomService = await createOrder(db, tenant.id, {
    channel: 'Room service',
    customerId: achieng.id,
    reservationId: stay.id,
    locationId: null,
    notes: '',
  });
  const line = (itemId: string, quantity: number) => ({
    itemId,
    description: '',
    quantity,
    unitPriceMinor: null,
    note: '',
  });
  await addOrderLine(db, tenant.id, roomService.id, line(lager.id, 2), 0);
  await addOrderLine(db, tenant.id, roomService.id, line(breakfast.id, 2), 1);
  await setOrderStatus(db, roomService.id, 'sent');
  await setOrderStatus(db, roomService.id, 'fulfilled');

  // A walk-in sale at the counter, paid in cash on the spot.
  const counter = await createOrder(db, tenant.id, {
    channel: 'Counter',
    customerId: null,
    reservationId: null,
    locationId: null,
    notes: '',
  });
  await addOrderLine(db, tenant.id, counter.id, line(soda.id, 3), 0);
  for (const status of ['sent', 'fulfilled', 'paid'] as const)
    await setOrderStatus(db, counter.id, status);

  // One bill for the stay and its room service, issued with a deposit.
  const invoiceId = await draftInvoiceForSource(db, tenant.id, {
    source: { type: 'reservation', id: stay.id },
    customerId: achieng.id,
    lines: [
      {
        description: 'Room 101 · Anniversary weekend',
        quantity: 1,
        unitPriceMinor: stay.price_minor,
        taxRateBp: 0,
      },
      ...(await reservationOrderInvoiceLines(db, tenant.id, stay.id)),
    ],
  });
  await issueInvoice(db, invoiceId);
  await recordPayment(db, tenant.id, invoiceId, {
    amountMinor: money(4500),
    method: 'cash',
    reference: null,
    note: 'Deposit',
  });
}
