import Link from 'next/link';
import { getTenantContext } from '@kitto/auth/server';
import { ADMIN_SECTIONS } from '@kitto/admin';
import { Card, Money, PageHeader, Stat } from '@kitto/ui';

export default async function TenantHome({ params }: PageProps<'/t/[tenant]'>) {
  const ctx = await getTenantContext((await params).tenant);
  const sections = ADMIN_SECTIONS.filter((s) => ctx.can(s.permission));
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
