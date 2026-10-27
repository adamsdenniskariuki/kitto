import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { AuditPage } from '@kitto/admin';

export const metadata: Metadata = { title: 'Audit log' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/admin/audit'>) {
  // Later modules add their audited tables here, e.g. [...CORE_AUDITED_TABLES, 'bookings'].
  return (
    <AuditPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
