import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { LowStockPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Low stock' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/low'>) {
  return (
    <LowStockPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
