import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { InvoiceDetailPage } from '@kitto/billing';
import { InvoiceMpesa, MPESA_MESSAGES } from '@kitto/mpesa';

export const metadata: Metadata = { title: 'Invoice' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/invoices/[id]'>) {
  const { tenant, id } = await params;
  const ctx = await getTenantContext(tenant);
  return (
    <InvoiceDetailPage
      ctx={ctx}
      searchParams={await searchParams}
      invoiceId={id}
      // M-Pesa composes in here; billing itself doesn't know about M-Pesa.
      sections={[(inv) => <InvoiceMpesa ctx={ctx} invoice={inv} />]}
      messages={MPESA_MESSAGES}
      sourceHref={(type, sourceId) =>
        type === 'reservation'
          ? `/bookings/${sourceId}`
          : type === 'order'
            ? `/orders/${sourceId}`
            : null
      }
    />
  );
}
