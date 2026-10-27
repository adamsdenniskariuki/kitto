import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { StaffPage } from '@kitto/admin';

export const metadata: Metadata = { title: 'Staff' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/admin/staff'>) {
  return (
    <StaffPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
