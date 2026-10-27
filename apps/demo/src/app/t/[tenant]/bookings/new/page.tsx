import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { NewReservationPage } from '@kitto/booking';

export const metadata: Metadata = { title: 'New reservation' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/bookings/new'>) {
  return (
    <NewReservationPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
