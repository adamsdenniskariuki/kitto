import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { MovementsPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Stock movements' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/movements'>) {
  return (
    <MovementsPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
