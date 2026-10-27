import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { resolveTenant, type Database } from '@kitto/core';
import { cookieDomain, isGlobalPath, LAST_TENANT_COOKIE, readConfig } from './config';

export interface KittoProxyOptions {
  /** Paths that need a signed-in user (optimistic check; RLS is the real one). */
  protectedPrefixes?: readonly string[];
  loginPath?: string;
}

type CookieToSet = {
  name: string;
  value: string;
  options?: Parameters<NextResponse['cookies']['set']>[2];
};

/**
 * Build the Next.js proxy (formerly "middleware"). On every request it:
 *  1. refreshes the Supabase session and writes updated auth cookies;
 *  2. in subdomain mode, rewrites acme.example.com/x to /t/acme/x so the same
 *     app routes serve both tenant modes;
 *  3. sends signed-out users on protected paths to /login?next=...;
 *  4. remembers the last tenant opened, so "/" can return there.
 *
 *   // src/proxy.ts
 *   export const proxy = createKittoProxy();
 *   export const config = { matcher: [...] };
 */
export function createKittoProxy(options: KittoProxyOptions = {}) {
  const protectedPrefixes = options.protectedPrefixes ?? ['/t/', '/onboarding', '/invite/'];
  const loginPath = options.loginPath ?? '/login';

  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const config = readConfig();
    const domain = cookieDomain(config.tenant);
    const url = request.nextUrl;

    let pathname = url.pathname;
    let rewrite: URL | null = null;
    let slug: string | null = null;
    if (config.tenant.mode === 'subdomain') {
      const resolved = resolveTenant(config.tenant, request.headers.get('host') ?? '', pathname);
      if (resolved && !isGlobalPath(pathname)) {
        slug = resolved.slug;
        rewrite = url.clone();
        rewrite.pathname = `/t/${resolved.slug}${resolved.pathname === '/' ? '' : resolved.pathname}`;
        pathname = rewrite.pathname;
      }
    }
    slug ??= resolveTenant({ mode: 'path' }, '', pathname)?.slug ?? null;

    const pending: CookieToSet[] = [];
    let cacheHeaders: Record<string, string> = {};
    const supabase = createServerClient<Database>(config.supabaseUrl, config.supabaseAnonKey, {
      ...(domain ? { cookieOptions: { domain } } : {}),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          for (const c of cookiesToSet) {
            request.cookies.set(c.name, c.value);
            pending.push(c);
          }
          if (headers) cacheHeaders = headers;
        },
      },
    });

    // getClaims() verifies the JWT and refreshes it if needed. Don't run code
    // between createServerClient and this call.
    const { data } = await supabase.auth.getClaims();
    const signedIn = Boolean(data?.claims);

    let response: NextResponse;
    if (
      !signedIn &&
      protectedPrefixes.some((p) => pathname === p.replace(/\/$/, '') || pathname.startsWith(p))
    ) {
      // Sign-in lives on the root site; in subdomain mode come back to the tenant host.
      const login = new URL(
        loginPath,
        config.tenant.mode === 'subdomain' ? config.siteUrl : url.origin,
      );
      login.searchParams.set(
        'next',
        config.tenant.mode === 'subdomain' ? url.href : url.pathname + url.search,
      );
      response = NextResponse.redirect(login);
    } else if (rewrite) {
      response = NextResponse.rewrite(rewrite, { request: { headers: request.headers } });
    } else {
      response = NextResponse.next({ request: { headers: request.headers } });
    }

    for (const c of pending) response.cookies.set(c.name, c.value, c.options);
    for (const [k, v] of Object.entries(cacheHeaders)) response.headers.set(k, v);
    if (slug && signedIn && request.cookies.get(LAST_TENANT_COOKIE)?.value !== slug) {
      response.cookies.set(LAST_TENANT_COOKIE, slug, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
        httpOnly: true,
        ...(domain ? { domain } : {}),
      });
    }
    return response;
  };
}

/** A sensible matcher: skip static assets and images. Add webhook paths that need no session. */
export const DEFAULT_PROXY_MATCHER =
  '/((?!_next/static|_next/image|favicon.ico|api/mpesa/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)';
