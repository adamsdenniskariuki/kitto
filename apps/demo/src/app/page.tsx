import Link from 'next/link';
import { redirect } from 'next/navigation';
import { homeHref } from '@kitto/auth/server';
import { CenteredPage, buttonClass } from '@kitto/ui';

export default async function Home() {
  const href = await homeHref();
  if (href) redirect(href);
  return (
    <CenteredPage>
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Kitto</p>
      <h1 className="mt-2 text-3xl font-bold">One framework, many business apps</h1>
      <p className="mt-3 text-muted">
        This demo shows Kitto&apos;s building blocks: workspaces for each business, sign-in by email
        link, staff and roles, settings, and a full audit trail.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/login" className={buttonClass()}>
          Sign in
        </Link>
        <Link href="/login?next=/onboarding" className={buttonClass('secondary')}>
          Create a workspace
        </Link>
      </div>
    </CenteredPage>
  );
}
