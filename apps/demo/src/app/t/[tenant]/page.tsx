import Link from 'next/link';
import { getTenantContext } from '@kitto/auth/server';
import { ADMIN_SECTIONS } from '@kitto/admin';
import { BOOKING_PERMISSIONS, bookingNav } from '@kitto/booking';
import { customersNav } from '@kitto/customers';
import { Card, Money, PageHeader, Stat } from '@kitto/ui';

export default async function TenantHome({ params }: PageProps<'/t/[tenant]'>) {
  const ctx = await getTenantContext((await params).tenant);
  const sections = ADMIN_SECTIONS.filter((s) => ctx.can(s.permission));
  const modules = [
    ...(ctx.can(BOOKING_PERMISSIONS.create)
      ? [{ href: ctx.path('/bookings/new'), label: 'New reservation' }]
      : []),
    ...bookingNav(ctx),
    ...(ctx.can(BOOKING_PERMISSIONS.configure)
      ? [{ href: ctx.path('/bookings/resources'), label: 'Resources' }]
      : []),
    ...customersNav(ctx),
  ];
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title={ctx.tenant.name}
        description={`Signed in as ${ctx.user.email}. Your role is ${ctx.role.name}.`}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Your role" value={ctx.role.name} />
        <Stat
          label="Currency"
          value={ctx.tenant.currency}
          hint={<Money minor={123456} tenant={ctx.tenant} />}
        />
        <Stat label="Time zone" value={ctx.tenant.timezone} />
      </div>
      {modules.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Get started</h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {modules.map((m) => (
              <li key={m.href}>
                <Link
                  href={m.href}
                  className="font-medium text-brand underline-offset-4 hover:underline"
                >
                  {m.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {sections.length > 0 && (
        <Card className="mt-6">
          <h2 className="mb-3 font-semibold">Admin shortcuts</h2>
          <ul className="flex flex-wrap gap-x-6 gap-y-2">
            {sections.map((s) => (
              <li key={s.path}>
                <Link
                  href={ctx.path(s.path)}
                  className="font-medium text-brand underline-offset-4 hover:underline"
                >
                  {s.label}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
