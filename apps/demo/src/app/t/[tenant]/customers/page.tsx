import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { CustomersPage } from '@kitto/customers';

export const metadata: Metadata = { title: 'Customers' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/customers'>) {
  return (
    <CustomersPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
