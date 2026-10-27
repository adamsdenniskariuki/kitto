import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { ReservationDetailPage } from '@kitto/booking';

export const metadata: Metadata = { title: 'Reservation' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/bookings/[id]'>) {
  const { tenant, id } = await params;
  return (
    <ReservationDetailPage
      ctx={await getTenantContext(tenant)}
      searchParams={await searchParams}
      reservationId={id}
    />
  );
}
