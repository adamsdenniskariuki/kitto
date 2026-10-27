import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { PurchaseDetailPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Purchase' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/purchases/[id]'>) {
  const { tenant, id } = await params;
  return (
    <PurchaseDetailPage
      ctx={await getTenantContext(tenant)}
      searchParams={await searchParams}
      purchaseId={id}
    />
  );
}
