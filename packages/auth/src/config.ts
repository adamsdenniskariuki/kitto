import type { TenantResolutionConfig } from '@kitto/core';

/**
 * Runtime configuration, read from NEXT_PUBLIC_* variables (see .env.example).
 * Each variable is referenced literally so Next.js can inline it into
 * browser bundles. Values are read lazily so `next build` works without them.
 */
export interface KittoAuthConfig {
  siteUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  tenant: TenantResolutionConfig;
}

export function tenantConfig(): TenantResolutionConfig {
  return process.env.NEXT_PUBLIC_TENANT_MODE === 'subdomain'
    ? { mode: 'subdomain', rootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN || 'localhost:3000' }
    : { mode: 'path' };
}

export function readConfig(): KittoAuthConfig {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (copy .env.example to .env.local).',
    );
  }
  return {
    siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, ''),
    supabaseUrl,
    supabaseAnonKey,
    tenant: tenantConfig(),
  };
}

/** "https" or "http", taken from the site URL; used to build cross-tenant URLs. */
export function siteProtocol(siteUrl: string): string {
  return new URL(siteUrl).protocol.replace(':', '');
}

/**
 * Cookie domain for subdomain mode, so one sign-in covers every tenant
 * subdomain (".example.com"). Browsers refuse Domain=localhost, so locally
 * use a wildcard loopback domain such as lvh.me (docs/SETUP.md).
 */
export function cookieDomain(config: TenantResolutionConfig): string | undefined {
  if (config.mode !== 'subdomain' || !config.rootDomain) return undefined;
  const host = config.rootDomain.replace(/:\d+$/, '').toLowerCase();
  if (host === 'localhost' || /^[\d.]+$/.test(host) || host.startsWith('[')) return undefined;
  return `.${host}`;
}

/** Cookie remembering the tenant the user last opened (a convenience, not a security boundary). */
export const LAST_TENANT_COOKIE = 'kitto_tenant';

/**
 * Paths served from the root app even on a tenant subdomain (sign-in,
 * onboarding, invitations, API routes). Everything else on a tenant host is
 * rewritten to /t/<slug>/...
 */
export const GLOBAL_PATHS: readonly string[] = [
  '/auth',
  '/login',
  '/onboarding',
  '/invite',
  '/api',
];

export function isGlobalPath(pathname: string): boolean {
  return GLOBAL_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
