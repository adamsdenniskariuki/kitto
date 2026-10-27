import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { LocationsPage } from '@kitto/inventory';

export const metadata: Metadata = { title: 'Locations' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/inventory/locations'>) {
  return (
    <LocationsPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
