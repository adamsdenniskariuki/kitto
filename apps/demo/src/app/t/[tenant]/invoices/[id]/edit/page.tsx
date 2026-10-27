import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { EditInvoicePage } from '@kitto/billing';

export const metadata: Metadata = { title: 'Edit draft' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/invoices/[id]/edit'>) {
  const { tenant, id } = await params;
  return (
    <EditInvoicePage
      ctx={await getTenantContext(tenant)}
      searchParams={await searchParams}
      invoiceId={id}
    />
  );
}
