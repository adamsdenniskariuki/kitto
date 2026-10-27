import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { NewInvoicePage } from '@kitto/billing';

export const metadata: Metadata = { title: 'New invoice' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/invoices/new'>) {
  return (
    <NewInvoicePage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
