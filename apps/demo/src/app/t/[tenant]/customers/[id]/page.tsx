import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { CustomerInvoices } from '@kitto/billing';
import { CustomerReservations } from '@kitto/booking';
import { CustomerDetailPage } from '@kitto/customers';

export const metadata: Metadata = { title: 'Customer' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/customers/[id]'>) {
  const { tenant, id } = await params;
  const ctx = await getTenantContext(tenant);
  return (
    <CustomerDetailPage
      ctx={ctx}
      searchParams={await searchParams}
      customerId={id}
      // Other modules add sections here; customers itself doesn't know about bookings.
      sections={[
        (c) => <CustomerReservations ctx={ctx} customerId={c.id} />,
        (c) => <CustomerInvoices ctx={ctx} customerId={c.id} />,
      ]}
    />
  );
}
