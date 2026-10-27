import { tenantUrl } from '@kitto/core';
import { buttonClass } from '@kitto/ui';
import { readConfig, siteProtocol } from './config';

export * from './config';
export * from './redirect';

interface SwitcherTenant {
  slug: string;
  name: string;
  role_name: string;
}

/**
 * Tenant switcher: a disclosure listing the user's tenants. Works without
 * JavaScript. Opening a tenant updates the "last tenant" cookie (see proxy).
 */
export function TenantSwitcher({
  current,
  tenants,
}: {
  current: SwitcherTenant;
  tenants: readonly SwitcherTenant[];
}) {
  const config = readConfig();
  const protocol = siteProtocol(config.siteUrl);
  return (
    <details className="relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl px-2 font-semibold hover:bg-surface-2">
        <span className="truncate">{current.name}</span>
        <span className="text-xs font-normal text-muted">{current.role_name}</span>
        <span aria-hidden="true" className="text-muted">
          ▾
        </span>
        <span className="sr-only">Switch workspace</span>
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-72 max-w-[90vw] rounded-2xl border border-line bg-surface p-2 shadow-lg">
        <ul className="space-y-1">
          {tenants.map((t) => (
            <li key={t.slug}>
              <a
                href={tenantUrl(config.tenant, t.slug, '/', protocol)}
                aria-current={t.slug === current.slug ? 'true' : undefined}
                className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2 aria-[current=true]:bg-brand-soft"
              >
                <span className="truncate font-medium">{t.name}</span>
                <span className="text-xs text-muted">{t.role_name}</span>
              </a>
            </li>
          ))}
        </ul>
        <a
          href={`${config.siteUrl}/onboarding`}
          className="mt-2 block rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface-2"
        >
          + New workspace
        </a>
      </div>
    </details>
  );
}

/** POST sign-out button (pairs with createSignOutRoute at /auth/signout). */
export function SignOutButton({ action = '/auth/signout' }: { action?: string }) {
  return (
    <form action={action} method="post">
      <button type="submit" className={buttonClass('ghost', 'sm')}>
        Sign out
      </button>
    </form>
  );
}
