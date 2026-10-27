/**
 * Tenant resolution: work out which tenant a request is for.
 *
 *   subdomain mode   acme.example.com/bookings   -> slug "acme", path "/bookings"
 *   path mode        example.com/t/acme/bookings -> slug "acme", path "/bookings"
 *
 * Both modes are pure functions of (host, pathname) so they run in Next.js
 * middleware, server components and tests alike. Resolving a slug only says
 * which tenant the URL *names*; access is still enforced by RLS.
 */

export type TenantMode = 'subdomain' | 'path';

export interface TenantResolutionConfig {
  mode: TenantMode;
  /** Apex domain for subdomain mode, e.g. "example.com" or "localhost:3000". */
  rootDomain?: string;
  /** URL prefix for path mode. Defaults to "/t". */
  pathPrefix?: string;
}

export interface ResolvedTenant {
  slug: string;
  /** The request path with the tenant segment removed (always starts with "/"). */
  pathname: string;
}

export const TENANT_SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

/** Subdomains that never name a tenant. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www',
  'app',
  'api',
  'admin',
  'auth',
  'login',
  'static',
  'assets',
  'mail',
  'status',
]);

export function isValidTenantSlug(slug: string): boolean {
  return TENANT_SLUG_PATTERN.test(slug) && !RESERVED_SLUGS.has(slug);
}

function stripPort(host: string): string {
  return host.replace(/:\d+$/, '');
}

export function resolveTenant(
  config: TenantResolutionConfig,
  host: string,
  pathname: string,
): ResolvedTenant | null {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;

  if (config.mode === 'subdomain') {
    if (!config.rootDomain) throw new Error('rootDomain is required in subdomain mode');
    const hostname = stripPort(host.trim().toLowerCase());
    const root = stripPort(config.rootDomain.trim().toLowerCase());
    if (!hostname.endsWith(`.${root}`)) return null;
    const sub = hostname.slice(0, -(root.length + 1));
    if (sub.includes('.') || !isValidTenantSlug(sub)) return null;
    return { slug: sub, pathname: path };
  }

  const prefix = (config.pathPrefix ?? '/t').replace(/\/+$/, '');
  if (!path.startsWith(`${prefix}/`)) return null;
  const [slug = '', ...rest] = path.slice(prefix.length + 1).split('/');
  const normalized = slug.toLowerCase();
  if (!isValidTenantSlug(normalized)) return null;
  return { slug: normalized, pathname: `/${rest.join('/')}` };
}

/**
 * Link to a page of the tenant the user is already on. In path mode that is
 * "/t/acme/bookings"; in subdomain mode the host already names the tenant, so
 * it is just "/bookings". Use tenantUrl() to link across tenants.
 */
export function tenantPath(config: TenantResolutionConfig, slug: string, path = '/'): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (config.mode === 'subdomain') return p;
  const prefix = (config.pathPrefix ?? '/t').replace(/\/+$/, '');
  return `${prefix}/${slug}${p === '/' ? '' : p}`;
}

/** Build an absolute-path or absolute URL for a page inside a tenant. */
export function tenantUrl(
  config: TenantResolutionConfig,
  slug: string,
  path = '/',
  protocol = 'https',
): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  if (config.mode === 'subdomain') {
    if (!config.rootDomain) throw new Error('rootDomain is required in subdomain mode');
    return `${protocol}://${slug}.${config.rootDomain}${p}`;
  }
  const prefix = (config.pathPrefix ?? '/t').replace(/\/+$/, '');
  return `${prefix}/${slug}${p === '/' ? '' : p}`;
}
