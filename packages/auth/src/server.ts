import 'server-only';
import { cache } from 'react';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import {
  can,
  commonErrorCode,
  getTenantBySlug,
  myPermissions,
  myTenants,
  tenantPath,
  tenantUrl,
  withQuery,
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

/** What a tenant Server Action reports back: a notice or an error code, optionally to another page. */
export type ActionOutcome =
  | { notice: string; path?: string; params?: Record<string, string> }
  | { error: string; path?: string; params?: Record<string, string> };

/**
 * The shape every module's form actions share:
 *   1. load the tenant from the hidden `tenant` field (re-checks membership);
 *   2. 404 unless the user holds `permission` (a friendly early check; RLS and
 *      the SQL guards are the real enforcement);
 *   3. run `work`; thrown errors become codes via `classify`;
 *   4. revalidate and redirect to `page` (or outcome.path) with ?notice= / ?error=.
 * Forms therefore work without JavaScript. `page` is tenant-relative, e.g. '/customers'.
 */
export async function runTenantAction(
  formData: FormData,
  permission: string | readonly string[],
  page: string,
  work: (ctx: TenantContext) => Promise<ActionOutcome>,
  classify: (e: unknown) => string = commonErrorCode,
): Promise<never> {
  const slug = formData.get('tenant');
  if (typeof slug !== 'string' || !slug) notFound();
  const ctx = await getTenantContext(slug);
  requirePermission(ctx, ...(typeof permission === 'string' ? [permission] : permission));
  let outcome: ActionOutcome;
  try {
    outcome = await work(ctx);
  } catch (e) {
    outcome = { error: classify(e) };
  }
  const target = ctx.path(outcome.path ?? page);
  revalidatePath(ctx.path(page));
  if (outcome.path) revalidatePath(target.split('?')[0]!);
  redirect(
    withQuery(target, {
      ...outcome.params,
      ...('notice' in outcome ? { notice: outcome.notice } : { error: outcome.error }),
    }),
  );
}

/** A string field from FormData ('' when missing or a file). */
export function formString(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === 'string' ? v : '';
}

export type SearchParams = Record<string, string | string[] | undefined>;

/** Props every module page takes: the app's route resolves the tenant and passes it in. */
export interface TenantPageProps {
  ctx: TenantContext;
  searchParams?: SearchParams | undefined;
}

/** A single query-string value ('' when missing or repeated). */
export function param(searchParams: SearchParams | undefined, key: string): string {
  const v = searchParams?.[key];
  return typeof v === 'string' ? v : '';
}
