import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { NewItemPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'New item' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/items/new'>) {
  return (
    <NewItemPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
