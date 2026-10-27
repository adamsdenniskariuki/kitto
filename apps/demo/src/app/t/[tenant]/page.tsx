import Link from 'next/link';
import { getTenantContext } from '@kitto/auth/server';
import { ADMIN_SECTIONS } from '@kitto/admin';
import { BILLING_PERMISSIONS, billingNav } from '@kitto/billing';
import { BOOKING_PERMISSIONS, bookingNav } from '@kitto/booking';
import { flashMessages } from '@kitto/core';
import { CUSTOMER_PERMISSIONS, customersNav } from '@kitto/customers';
import { INVENTORY_PERMISSIONS, inventoryNav, LowStockCard } from '@kitto/inventory';
import { ORDER_PERMISSIONS, ordersNav } from '@kitto/orders';
import { reportsNav, ReportsKpiCard } from '@kitto/reports';
import { Card, Flash, Money, PageHeader, Stat, TenantField } from '@kitto/ui';
import { SubmitButton } from '@kitto/ui/client';
import { canLoadSampleData, isEmptyWorkspace } from '@/lib/sample-data';
import { loadSampleDataAction } from './actions';

const NOTICES = { sample_loaded: 'Sample data loaded. Have a look around.' };
const ERRORS = { sample_not_empty: 'Sample data can only be added to an empty workspace.' };

interface ModuleCard {
  title: string;
  what: string;
  links: { href: string; label: string }[];
}

export default async function TenantHome({ params, searchParams }: PageProps<'/t/[tenant]'>) {
  const ctx = await getTenantContext((await params).tenant);
  const flash = flashMessages(await searchParams, NOTICES, ERRORS);
  const sections = ADMIN_SECTIONS.filter((s) => ctx.can(s.permission));
  const link = (permission: string, path: string, label: string) =>
    ctx.can(permission) ? [{ href: ctx.path(path), label }] : [];

  // One card per module: what it does, and the pages this role may open.
  const modules: ModuleCard[] = [
    {
      title: 'Bookings',
      what: 'Rooms, tables, courts or bays with opening hours and rates. Postgres refuses double-bookings.',
      links: [
        ...bookingNav(ctx),
        ...link(BOOKING_PERMISSIONS.create, '/bookings/new', 'New reservation'),
        ...link(BOOKING_PERMISSIONS.configure, '/bookings/resources', 'Resources'),
      ],
    },
    {
      title: 'Orders',
      what: 'Restaurant, bar or parts-counter orders. Sending one takes stock; charge it to a booking.',
      links: [...ordersNav(ctx), ...link(ORDER_PERMISSIONS.create, '/orders/new', 'New order')],
    },
    {
      title: 'Inventory',
      what: 'Items, suppliers, purchases and a stock ledger that never goes below zero.',
      links: [
        ...inventoryNav(ctx),
        ...link(INVENTORY_PERMISSIONS.view, '/inventory/low', 'Low stock'),
      ],
    },
    {
      title: 'Customers',
      what: 'Contacts, tags and notes, with each customer’s bookings, orders and invoices.',
      links: [
        ...customersNav(ctx),
        ...link(CUSTOMER_PERMISSIONS.create, '/customers/new', 'Add a customer'),
      ],
    },
    {
      title: 'Invoices',
      what: 'Quotes and invoices with gapless numbers, payments, PDFs and M-Pesa requests.',
      links: [
        ...billingNav(ctx),
        ...link(BILLING_PERMISSIONS.create, '/invoices/new', 'New invoice'),
      ],
    },
    {
      title: 'Reports',
      what: 'Revenue, collections, utilisation, best sellers and stock value as accessible charts.',
      links: reportsNav(ctx),
    },
  ].filter((m) => m.links.length > 0);

  const offerSample = canLoadSampleData(ctx) && (await isEmptyWorkspace(ctx));

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title={ctx.tenant.name}
        description={`Signed in as ${ctx.user.email}. Your role is ${ctx.role.name}.`}
      />
      <Flash {...flash} />
      {offerSample && (
        <Card className="mb-6" aria-labelledby="sample-heading">
          <h2 id="sample-heading" className="font-semibold">
            New here? Load sample data
          </h2>
          <p className="mt-1 max-w-prose text-muted">
            Adds a small guest house: customers, rooms and a meeting room with bookings, drinks in
            stock, a room-service order, a counter sale and a part-paid invoice. Everything goes
            through the same rules as the forms, and every change appears in the audit log.
          </p>
          <form action={loadSampleDataAction} className="mt-4">
            <TenantField slug={ctx.tenant.slug} />
            <SubmitButton pendingLabel="Loading sample data…">Load sample data</SubmitButton>
          </form>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Your role" value={ctx.role.name} />
        <Stat
          label="Currency"
          value={ctx.tenant.currency}
          hint={<Money minor={123456} tenant={ctx.tenant} />}
        />
        <Stat label="Time zone" value={ctx.tenant.timezone} />
      </div>
      {modules.length > 0 && (
        <section aria-labelledby="modules-heading" className="mt-6">
          <h2 id="modules-heading" className="mb-3 text-lg font-semibold">
            Get started
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((m) => (
              <li key={m.title} className="card flex flex-col">
                <h3 className="font-semibold">{m.title}</h3>
                <p className="mt-1 flex-1 text-sm text-muted">{m.what}</p>
                <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                  {m.links.map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className="font-medium text-brand underline-offset-4 hover:underline"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ReportsKpiCard ctx={ctx} />
        <LowStockCard ctx={ctx} />
      </div>
      {sections.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Admin shortcuts</h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {sections.map((s) => (
              <li key={s.path}>
                <Link
                  href={ctx.path(s.path)}
                  className="font-medium text-brand underline-offset-4 hover:underline"
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
