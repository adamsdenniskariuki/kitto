import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { SignOutButton, TenantSwitcher } from '@kitto/auth';
import { getTenantContext } from '@kitto/auth/server';
import { ADMIN_PERMISSIONS } from '@kitto/admin';
import { billingNav } from '@kitto/billing';
import { bookingNav } from '@kitto/booking';
import { customersNav } from '@kitto/customers';
import { inventoryNav } from '@kitto/inventory';
import { ordersNav } from '@kitto/orders';
import { reportsNav } from '@kitto/reports';
import { AppShell, ThemeStyle } from '@kitto/ui';
import { ThemeToggle } from '@kitto/ui/client';
import { NavLinks, type NavItem } from '@kitto/ui/next';
import { COLOR_SCHEME_COOKIE, parseColorScheme } from '@kitto/ui/themes';

export async function generateMetadata({ params }: LayoutProps<'/t/[tenant]'>): Promise<Metadata> {
  const ctx = await getTenantContext((await params).tenant);
  return { title: { default: ctx.tenant.name, template: `%s · ${ctx.tenant.name}` } };
}

export default async function TenantLayout({
  children,
  params,
}: LayoutProps<'/t/[tenant]'> & { children: ReactNode }) {
  const ctx = await getTenantContext((await params).tenant);
  const scheme = parseColorScheme((await cookies()).get(COLOR_SCHEME_COOKIE)?.value);
  const current = ctx.tenants.find((t) => t.slug === ctx.tenant.slug)!;

  const nav: NavItem[] = [
    { href: ctx.path('/'), label: 'Home', exact: true },
    ...bookingNav(ctx),
    ...ordersNav(ctx),
    ...inventoryNav(ctx),
    ...customersNav(ctx),
    ...billingNav(ctx),
    ...reportsNav(ctx),
  ];
  if (ADMIN_PERMISSIONS.some((p) => ctx.can(p)))
    nav.push({ href: ctx.path('/admin'), label: 'Admin' });

  return (
    <>
      <ThemeStyle theme={ctx.tenant.theme} />
      <AppShell
        brand={<TenantSwitcher current={current} tenants={ctx.tenants} />}
        actions={
          <>
            <ThemeToggle initial={scheme} />
            <SignOutButton />
          </>
        }
        nav={<NavLinks items={nav} label="Main" />}
      >
        {children}
      </AppShell>
    </>
  );
}
