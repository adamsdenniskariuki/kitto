import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { AdminHome } from '@kitto/admin';

export const metadata: Metadata = { title: 'Admin' };

export default async function Page({ params }: PageProps<'/t/[tenant]/admin'>) {
  return <AdminHome ctx={await getTenantContext((await params).tenant)} />;
}
