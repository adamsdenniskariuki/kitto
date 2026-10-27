import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { ResourcesPage } from '@kitto/booking';

export const metadata: Metadata = { title: 'Resources' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/bookings/resources'>) {
  return (
    <ResourcesPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
