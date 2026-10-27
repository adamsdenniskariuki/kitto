import Link from 'next/link';
import { redirect } from 'next/navigation';
import { homeHref } from '@kitto/auth/server';
import { buttonClass } from '@kitto/ui';

const FEATURES = [
  ['Workspaces', 'Each business gets its own workspace, address, currency, time zone and theme.'],
  ['Staff and roles', 'Invite staff by email and choose what each role may see and do.'],
  ['Bookings', 'Rooms, tables or bays with opening hours, rates and no double-booking.'],
  ['Orders and stock', 'Orders take stock when sent; purchases add it; levels never go negative.'],
  ['Invoices and M-Pesa', 'Quotes, gapless invoice numbers, payments and STK push requests.'],
  ['Reports and audit', 'Charts for revenue and utilisation, and a log of every change.'],
] as const;

export default async function Home() {
  const href = await homeHref();
  if (href) redirect(href);
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-4 py-10">
      <p className="text-sm font-semibold tracking-wide text-brand uppercase">Kitto demo</p>
      <h1 className="mt-2 text-3xl font-bold text-balance sm:text-4xl">
        One framework, many business apps
      </h1>
      <p className="mt-3 max-w-prose text-muted">
        Kitto is a toolkit for multi-tenant business apps such as hotels, garages and shops. This
        demo wires up every module. Sign in with your email, create a workspace, then press{' '}
        <strong className="text-ink">Load sample data</strong> to explore a small guest house.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/login" className={buttonClass()}>
          Sign in
        </Link>
        <Link href="/login?next=/onboarding" className={buttonClass('secondary')}>
          Create a workspace
        </Link>
      </div>
      <h2 className="mt-10 text-lg font-semibold">What&apos;s inside</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {FEATURES.map(([title, text]) => (
          <li key={title} className="card">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-1 text-sm text-muted">{text}</p>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">
        Sign-in links arrive by email. When running locally, open Mailpit at{' '}
        <code>http://127.0.0.1:55324</code> to find them.
      </p>
    </main>
  );
}
