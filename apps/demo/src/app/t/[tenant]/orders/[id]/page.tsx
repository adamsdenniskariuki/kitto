import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { SourceInvoices } from '@kitto/billing';
import { OrderDetailPage, orderInvoiceLines } from '@kitto/orders';

export const metadata: Metadata = { title: 'Order' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/orders/[id]'>) {
  const { tenant, id } = await params;
  const ctx = await getTenantContext(tenant);
  return (
    <OrderDetailPage
      ctx={ctx}
      searchParams={await searchParams}
      orderId={id}
      invoiceHref={(invoiceId) => `/invoices/${invoiceId}`}
      reservationHref={(reservationId) => `/bookings/${reservationId}`}
      // Billing composes in here; orders itself doesn't depend on billing.
      sections={[
        (o, lines) => (
          <SourceInvoices
            ctx={ctx}
            source={{ type: 'order', id: o.id }}
            customerId={o.customer_id}
            returnTo={`/orders/${o.id}`}
            lines={
              (o.status === 'sent' || o.status === 'fulfilled') && o.invoice_id === null
                ? orderInvoiceLines(lines)
                : []
            }
          />
        ),
      ]}
    />
  );
}
