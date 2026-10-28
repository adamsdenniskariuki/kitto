export interface KittoModule {
  name: string;
  summary: string;
  permissions: string[];
  /** Every app gets the foundation; business modules are opt-in. */
  foundation: boolean;
}

/** The packages in packages/*, as described in the README's module table. */
export const MODULES: readonly KittoModule[] = [
  {
    name: '@kitto/core',
    summary:
      'Tenants, members, roles as data, has_permission and RLS helpers, a generic audit trigger, money and date formatting, a typed DB client.',
    permissions: ['tenant.manage', 'members.manage', 'roles.manage', 'audit.view'],
    foundation: true,
  },
  {
    name: '@kitto/auth',
    summary:
      'Magic-link sign-in, a proxy for sessions and path or subdomain tenant URLs, getTenantContext, runTenantAction and invitations.',
    permissions: [],
    foundation: true,
  },
  {
    name: '@kitto/ui',
    summary:
      'Accessible (WCAG AA), mobile-first components, themes and dark mode, forms, data tables, flash messages, per-tenant currency.',
    permissions: [],
    foundation: true,
  },
  {
    name: '@kitto/admin',
    summary:
      'Admin portal pages: staff and invitations, a roles editor, workspace settings (theme, currency, time zone) and the audit log.',
    permissions: ['uses the core permissions'],
    foundation: true,
  },
  {
    name: '@kitto/customers',
    summary:
      'Customers with search, a notes timeline and archive, plus section slots that other modules fill.',
    permissions: ['customers.view/create/edit/delete'],
    foundation: false,
  },
  {
    name: '@kitto/booking',
    summary:
      'Resources (rooms, bays, tables) with hours and rates, double-booking-proof reservations, free slots, recurring series and an agenda.',
    permissions: ['booking.view/create/manage/configure'],
    foundation: false,
  },
  {
    name: '@kitto/billing',
    summary:
      'Quotes and invoices with gapless numbers, tax, payments, derived status and PDFs; bills any source, such as a reservation or an order.',
    permissions: ['billing.view/create/issue/void', 'payments.record'],
    foundation: false,
  },
  {
    name: '@kitto/mpesa',
    summary:
      'Daraja STK push for invoices, idempotent callbacks with hashed per-request tokens, and a mock mode for development and CI.',
    permissions: ['mpesa.request'],
    foundation: false,
  },
  {
    name: '@kitto/inventory',
    summary:
      'Items, suppliers, locations and purchases on an append-only stock ledger; no negative stock under concurrency; low-stock alerts.',
    permissions: ['inventory.view/manage/purchase/adjust/transfer'],
    foundation: false,
  },
  {
    name: '@kitto/orders',
    summary:
      'Restaurant, bar and counter orders that take stock when sent, charge to a reservation and become paid with their invoice.',
    permissions: ['orders.view/create/serve/cancel/bill'],
    foundation: false,
  },
  {
    name: '@kitto/reports',
    summary:
      'Revenue, payment methods, receivables aging, utilisation, top items, stock and new customers, with server-rendered SVG charts.',
    permissions: ['reports.view', "each module's .view"],
    foundation: false,
  },
];

export interface UseCase {
  title: string;
  summary: string;
  tone: 'a' | 'b' | 'c' | 'd';
  maps: { need: string; module: string }[];
}

/** From docs/TUTORIAL.md: how real apps map onto the modules. */
export const USE_CASES: readonly UseCase[] = [
  {
    title: 'Hotel or guest house',
    summary:
      'Rooms by the night, the restaurant and bar on the room bill, minibar stock and a folio at check-out. The demo sample data is a small hotel.',
    tone: 'a',
    maps: [
      { need: 'Rooms and conference rooms', module: 'booking' },
      { need: 'Restaurant, bar, room service', module: 'orders' },
      { need: 'Kitchen and minibar stock', module: 'inventory' },
      { need: 'Folio, deposits, M-Pesa', module: 'billing + mpesa' },
      { need: 'Occupancy and takings', module: 'reports' },
    ],
  },
  {
    title: 'Car dealership',
    summary:
      'Cars in stock, test drives, leads and buyers, and a sale with a deposit by M-Pesa and the rest on delivery.',
    tone: 'b',
    maps: [
      { need: 'Stock of cars', module: 'vehicles (generated)' },
      { need: 'Test drives', module: 'booking' },
      { need: 'Leads and buyers', module: 'customers' },
      { need: 'Sale and deposit', module: 'billing + mpesa' },
      { need: 'Accessories and parts', module: 'inventory + orders' },
    ],
  },
  {
    title: 'Garage and workshop',
    summary:
      'The tutorial app, "Kitto Garage": service bays booked by the hour, parts taken from stock for each job, and one invoice for labour and parts, paid by M-Pesa.',
    tone: 'd',
    maps: [
      { need: 'Customer cars', module: 'vehicles (generated)' },
      { need: 'Service bays', module: 'booking' },
      { need: 'Parts used on a job', module: 'orders + inventory' },
      { need: 'Labour and parts invoice', module: 'billing + mpesa' },
      { need: 'A "Mechanic" role', module: 'admin' },
    ],
  },
];

export interface Screenshot {
  file: string;
  title: string;
  alt: string;
}

/** Captured from the demo app with sample data by screenshots/demo.spec.ts. */
export const SCREENSHOTS: readonly Screenshot[] = [
  {
    file: 'workspace-home.png',
    title: 'Workspace home',
    alt: 'The home page of a demo lodge workspace, showing the owner role, Kenyan shilling currency and Nairobi time zone, then cards for bookings, orders, inventory, customers, invoices and reports.',
  },
  {
    file: 'admin-roles.png',
    title: 'Admin: roles',
    alt: 'The admin roles page, listing roles such as owner, manager, front desk, waiter and storekeeper with their permission counts, and a form to add a custom role.',
  },
  {
    file: 'bookings.png',
    title: 'Bookings',
    alt: 'The bookings agenda for the week, with a confirmed reservation for Room 101, a tentative one for Room 102 and the meeting room.',
  },
  {
    file: 'invoice.png',
    title: 'Billing: an invoice',
    alt: 'Invoice INV-00001, marked part paid, for guest Achieng Otieno, with lines for a Room 101 stay, Tusker lager and breakfast.',
  },
  {
    file: 'orders.png',
    title: 'Orders',
    alt: 'The orders list filtered to all orders: a fulfilled room service order for Achieng Otieno and a paid counter sale.',
  },
  {
    file: 'inventory.png',
    title: 'Inventory',
    alt: 'The inventory items list with stock levels, including bottled water below its reorder level.',
  },
  {
    file: 'reports.png',
    title: 'Reports',
    alt: 'The reports page for the last 30 days, with date filters and revenue totals: 11,200 shillings invoiced and 4,500 collected.',
  },
];
