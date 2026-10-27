import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { SourceInvoices } from '@kitto/billing';
import { ReservationDetailPage } from '@kitto/booking';

export const metadata: Metadata = { title: 'Reservation' };

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
      // Billing composes in here; booking itself doesn't depend on billing.
      sections={[
        (r) => (
          <SourceInvoices
            ctx={ctx}
            source={{ type: 'reservation', id: r.id }}
            customerId={r.customer_id}
            returnTo={`/bookings/${r.id}`}
            lines={
              r.price_minor > 0 && r.status !== 'cancelled'
                ? [
                    {
                      description: `${r.resource?.name ?? 'Reservation'}${r.title ? ` · ${r.title}` : ''}`,
                      quantity: 1,
                      unitPriceMinor: r.price_minor,
                      taxRateBp: 0,
                    },
                  ]
                : []
            }
          />
        ),
      ]}
    />
  );
}
