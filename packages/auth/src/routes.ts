import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { readConfig } from './config';
import { safeNextPath } from './redirect';
import { createClient } from './server';

const otpType = z.enum([
  'email',
  'magiclink',
  'signup',
  'invite',
  'recovery',
  'email_change',
]) satisfies z.ZodType<EmailOtpType>;

/**
 * GET handler for the link in auth emails:
 *   /auth/confirm?token_hash=...&type=email&next=/t/acme
 * verifyOtp() exchanges the one-time token for a session; the server client
 * writes the auth cookies onto the response.
 *
 *   // app/auth/confirm/route.ts
 *   export const GET = createConfirmRoute();
 */
export function createConfirmRoute({ fallback = '/' }: { fallback?: string } = {}) {
  return async function GET(request: NextRequest) {
    const { searchParams, origin } = request.nextUrl;
    const config = readConfig();
    const rootDomain = config.tenant.mode === 'subdomain' ? config.tenant.rootDomain : undefined;
    const next = safeNextPath(searchParams.get('next'), origin, fallback, rootDomain);
    const tokenHash = searchParams.get('token_hash');
    const type = otpType.safeParse(searchParams.get('type'));
    const code = searchParams.get('code');

    const supabase = await createClient();
    let ok = false;
    if (tokenHash && type.success) {
      const { error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
      ok = !error;
    } else if (code) {
      // PKCE fallback (e.g. if a hosted email template still uses {{ .ConfirmationURL }}).
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      ok = !error;
    }
    return NextResponse.redirect(new URL(ok ? next : '/login?error=link', origin));
  };
}

/**
 * POST-only sign-out, so a stray <img src="/auth/signout"> can't log people out.
 *
 *   // app/auth/signout/route.ts
 *   export const POST = createSignOutRoute();
 */
export function createSignOutRoute({ redirectTo = '/' }: { redirectTo?: string } = {}) {
  return async function POST(request: NextRequest) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    // 303 turns the POST into a GET for the redirect target.
    return NextResponse.redirect(
      new URL(redirectTo, readConfig().siteUrl || request.nextUrl.origin),
      {
        status: 303,
      },
    );
  };
}
