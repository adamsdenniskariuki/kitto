import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { RolesPage } from '@kitto/admin';

export const metadata: Metadata = { title: 'Roles' };

export default async function Page({ params, searchParams }: PageProps<'/t/[tenant]/admin/roles'>) {
  return (
    <RolesPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
