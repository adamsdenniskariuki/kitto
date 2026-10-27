import type { ReactNode } from 'react';
import { getTenantContext } from '@kitto/auth/server';
import { adminNav } from '@kitto/admin';
import { NavLinks } from '@kitto/ui/next';

export default async function AdminLayout({
  children,
  params,
}: LayoutProps<'/t/[tenant]/admin'> & { children: ReactNode }) {
  const ctx = await getTenantContext((await params).tenant);
  const items = adminNav(ctx);
  return (
    <>
      {items.length > 0 && (
        <div className="mb-6 border-b border-line">
          <NavLinks
            items={[{ href: ctx.path('/admin'), label: 'Overview', exact: true }, ...items]}
            label="Admin"
          />
        </div>
      )}
      {children}
    </>
  );
}
