import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { InventoryPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Inventory' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/inventory'>) {
  return (
    <InventoryPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
