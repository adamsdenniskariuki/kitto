import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { InvoicesPage } from '@kitto/billing';

export const metadata: Metadata = { title: 'Invoices' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/invoices'>) {
  return (
    <InvoicesPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
