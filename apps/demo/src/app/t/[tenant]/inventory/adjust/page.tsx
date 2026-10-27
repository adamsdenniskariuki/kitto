import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { AdjustStockPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Adjust stock' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/adjust'>) {
  return (
    <AdjustStockPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
