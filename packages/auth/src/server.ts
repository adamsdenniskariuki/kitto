import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import {
  can,
  getTenantBySlug,
  myPermissions,
  myTenants,
  tenantPath,
  tenantUrl,
  type Database,
  type KittoClient,
  type PermissionSet,
  type Tenant,
  type TenantResolutionConfig,
} from '@kitto/core';
import { cookieDomain, LAST_TENANT_COOKIE, readConfig, siteProtocol } from './config';

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 * It acts as the signed-in user (their JWT comes from cookies), so every
 * query is filtered by row-level security.
 */
export async function createClient(): Promise<KittoClient> {
  const config = readConfig();
  const cookieStore = await cookies();
  const domain = cookieDomain(config.tenant);
  return createServerClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    ...(domain ? { cookieOptions: { domain } } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // Server Components can't set cookies. The proxy refreshes the session on every request.
        }
      },
    },
  });
}

/**
 * A session-less client that always acts as `anon`. Used to send invitation
 * emails without touching the inviter's own session cookies.
 */
export function createAnonClient(): KittoClient {
  const config = readConfig();
  return createSupabaseClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export interface KittoUser {
  id: string;
  email: string;
}

/** The signed-in user, or null. Verifies the JWT (getClaims), never trusts an unverified session. */
export const getUser = cache(async (): Promise<{ db: KittoClient; user: KittoUser | null }> => {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const claims = data?.claims;
  return {
    db,
    user: claims
      ? { id: claims.sub, email: typeof claims.email === 'string' ? claims.email : '' }
      : null,
  };
});

/** The signed-in user, or a redirect to /login?next=... */
export async function requireUser(next = '/'): Promise<{ db: KittoClient; user: KittoUser }> {
  const { db, user } = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return { db, user };
}

export type MyTenant = Awaited<ReturnType<typeof myTenants>>[number];

/** Everything a tenant page needs: who, which tenant, which role and permissions. */
export interface TenantContext {
  db: KittoClient;
  user: KittoUser;
  tenant: Tenant;
  role: { key: string; name: string };
  permissions: PermissionSet;
  /** All tenants the user belongs to (for the switcher). */
  tenants: MyTenant[];
  config: TenantResolutionConfig;
  /** Link to a page of this tenant, e.g. ctx.path('/admin/staff'). */
  path: (path?: string) => string;
  /** UI mirror of has_permission(). RLS is still the real check. */
  can: (permission: string) => boolean;
}

/**
 * Load the tenant named in the URL for the signed-in user. Users who are not
 * an active member get a 404 (we don't reveal which tenants exist).
 * Cached per request, so layouts and pages can both call it.
 */
export const getTenantContext = cache(async (slug: string): Promise<TenantContext> => {
  const config = readConfig().tenant;
  const { db, user } = await requireUser(tenantPath(config, slug, '/'));
  const tenants = await myTenants(db);
  const membership = tenants.find((t) => t.slug === slug);
  if (!membership) notFound();
  const tenant = await getTenantBySlug(db, slug);
  if (!tenant) notFound();
  const permissions = await myPermissions(db, tenant.id, membership.role_key);
  return {
    db,
    user,
    tenant,
    role: { key: membership.role_key, name: membership.role_name },
    permissions,
    tenants,
    config,
    path: (p = '/') => tenantPath(config, slug, p),
    can: (perm) => can(permissions, perm),
  };
});

/** 404 unless the user holds the permission. Pages call this; RLS enforces it again in SQL. */
export function requirePermission(ctx: TenantContext, ...anyOf: string[]): void {
  if (!anyOf.some((p) => ctx.can(p))) notFound();
}

/** Absolute or path URL for a tenant page, valid from any host. */
export function tenantHref(slug: string, path = '/'): string {
  const config = readConfig();
  return tenantUrl(config.tenant, slug, path, siteProtocol(config.siteUrl));
}

/**
 * Where "/" should send a signed-in user: the tenant they last opened, their
 * first tenant, or onboarding. Signed-out users get null.
 */
export async function homeHref(): Promise<string | null> {
  const { db, user } = await getUser();
  if (!user) return null;
  const tenants = await myTenants(db);
  if (tenants.length === 0) return '/onboarding';
  const last = (await cookies()).get(LAST_TENANT_COOKIE)?.value;
  const pick = tenants.find((t) => t.slug === last) ?? tenants[0]!;
  return tenantHref(pick.slug);
}

/** Send a magic link that lands on /invite/<token> (used by the admin portal after creating an invitation). */
export async function sendInvitationEmail(email: string, token: string): Promise<void> {
  const config = readConfig();
  const { error } = await createAnonClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: `${config.siteUrl}/invite/${token}` },
  });
  if (error) throw new Error(error.status === 429 ? 'rate_limited' : 'email_failed');
}
