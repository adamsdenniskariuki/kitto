import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { SuppliersPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Suppliers' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/suppliers'>) {
  return (
    <SuppliersPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
