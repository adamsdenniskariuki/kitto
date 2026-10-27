import type { Metadata } from 'next';
import { getTenantContext, type TenantContext } from '@kitto/auth/server';
import { SourceInvoices } from '@kitto/billing';
import { ReservationDetailPage, type ReservationRow } from '@kitto/booking';
import { ORDER_PERMISSIONS, ReservationOrders, reservationOrderInvoiceLines } from '@kitto/orders';

export const metadata: Metadata = { title: 'Reservation' };

/**
 * The reservation's invoice: its price plus any orders charged to it (sent or
 * fulfilled, not yet invoiced). Invoicing it links those orders, and paying it
 * marks them paid.
 */
async function ReservationBilling({ ctx, r }: { ctx: TenantContext; r: ReservationRow }) {
  if (r.status === 'cancelled')
    return (
      <SourceInvoices
        ctx={ctx}
        source={{ type: 'reservation', id: r.id }}
        customerId={r.customer_id}
        returnTo={`/bookings/${r.id}`}
        lines={[]}
      />
    );
  const orderLines = ctx.can(ORDER_PERMISSIONS.view)
    ? await reservationOrderInvoiceLines(ctx.db, ctx.tenant.id, r.id)
    : [];
  return (
    <SourceInvoices
      ctx={ctx}
      source={{ type: 'reservation', id: r.id }}
      customerId={r.customer_id}
      returnTo={`/bookings/${r.id}`}
      lines={[
        ...(r.price_minor > 0
          ? [
              {
                description: `${r.resource?.name ?? 'Reservation'}${r.title ? ` · ${r.title}` : ''}`,
                quantity: 1,
                unitPriceMinor: r.price_minor,
                taxRateBp: 0,
              },
            ]
          : []),
        ...orderLines,
      ]}
    />
  );
}

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/bookings/[id]'>) {
  const { tenant, id } = await params;
  const ctx = await getTenantContext(tenant);
  return (
    <ReservationDetailPage
      ctx={ctx}
      searchParams={await searchParams}
      reservationId={id}
      // Orders and billing compose in here; booking itself depends on neither.
      sections={[
        (r) => (
          <ReservationOrders
            ctx={ctx}
            reservationId={r.id}
            canAdd={r.status !== 'cancelled' && r.status !== 'no_show'}
          />
        ),
        (r) => <ReservationBilling ctx={ctx} r={r} />,
      ]}
    />
  );
}
