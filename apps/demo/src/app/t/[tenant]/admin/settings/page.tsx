import type { Metadata } from 'next';
import { getTenantContext } from '@kitto/auth/server';
import { SettingsPage } from '@kitto/admin';

export const metadata: Metadata = { title: 'Settings' };

export default async function Page({
  params,
  searchParams,
}: PageProps<'/t/[tenant]/admin/settings'>) {
  return (
    <SettingsPage
      ctx={await getTenantContext((await params).tenant)}
      searchParams={await searchParams}
    />
  );
}
