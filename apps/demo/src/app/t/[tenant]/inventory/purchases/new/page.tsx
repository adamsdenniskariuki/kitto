import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { NewPurchasePage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'New purchase' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/purchases/new'>) {
  return (
    <NewPurchasePage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
