import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { NewOrderPage } from '@kitto/orders';

export const metadata: Metadata = { title: 'New order' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/orders/new'>) {
  return (
    <NewOrderPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
