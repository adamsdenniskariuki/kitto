import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { TransferStockPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Move stock' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/transfer'>) {
  return (
    <TransferStockPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
