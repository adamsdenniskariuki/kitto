import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { BookingsPage } from '@kitto/booking';

export const metadata: Metadata = { title: 'Bookings' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/bookings'>) {
  return (
    <BookingsPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
