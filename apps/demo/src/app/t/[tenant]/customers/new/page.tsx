import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { NewCustomerPage } from '@kitto/customers';

export const metadata: Metadata = { title: 'New customer' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/customers/new'>) {
  return (
    <NewCustomerPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
