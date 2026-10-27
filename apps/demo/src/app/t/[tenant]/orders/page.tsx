import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { OrdersPage } from '@kitto/orders';

export const metadata: Metadata = { title: 'Orders' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/orders'>) {
  return (
    <OrdersPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
