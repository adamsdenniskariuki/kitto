import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { ResourceDetailPage } from '@kitto/booking';

export const metadata: Metadata = { title: 'Resource' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/bookings/resources/[id]'>) {
  const { tenant, id } = await params;
  return (
    <ResourceDetailPage
      ctx={await getTenantContext(tenant)}
      searchParams={await searchParams}
      resourceId={id}
    />
  );
}
