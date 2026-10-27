import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { PurchasesPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Purchases' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/purchases'>) {
  return (
    <PurchasesPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
