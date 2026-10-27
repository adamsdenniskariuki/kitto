import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { ReportsPage } from '@kitto/reports';

export const metadata: Metadata = { title: 'Reports' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/reports'>) {
  return (
    <ReportsPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
