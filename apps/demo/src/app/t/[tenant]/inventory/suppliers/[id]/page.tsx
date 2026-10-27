import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { SupplierDetailPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Supplier' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/suppliers/[id]'>) {
  const { tenant, id } = await params;
  return (
    <SupplierDetailPage
      ctx={await getTenantContext(tenant)}
      searchParams={await searchParams}
      supplierId={id}
    />
  );
}
