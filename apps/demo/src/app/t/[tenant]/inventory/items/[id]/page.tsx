import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { ItemDetailPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Item' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/items/[id]'>) {
  const { tenant, id } = await params;
  return (
    <ItemDetailPage
      ctx={await getTenantContext(tenant)}
      searchParams={await searchParams}
      itemId={id}
    />
  );
}
