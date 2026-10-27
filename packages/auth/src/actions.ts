'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import {
  acceptInvitation,
  createTenant,
  createTenantSchema,
  fieldErrors,
  formValues,
  KittoError,
  myTenants,
  userMessage,
  type FormState,
} from '@kitto/core';
import { readConfig } from './config';
import { safeNextPath } from './redirect';
import { createClient, requireUser, tenantHref } from './server';

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address.')),
  next: z.string().max(2000).optional(),
});

/** Email a magic link. Works for new and returning users (the link creates the account). */
export async function sendMagicLink(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = loginSchema.safeParse({
    email: values.email ?? '',
    next: values.next || undefined,
  });
  if (!parsed.success) return { status: 'error', errors: fieldErrors(parsed.error), values };

  const config = readConfig();
  const rootDomain = config.tenant.mode === 'subdomain' ? config.tenant.rootDomain : undefined;
  const next = safeNextPath(parsed.data.next, config.siteUrl, '/', rootDomain);
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: true,
      // Becomes {{ .RedirectTo }} in the email template; /auth/confirm sends the user there.
      emailRedirectTo: new URL(next, config.siteUrl).toString(),
    },
  });
  if (error) {
    const message =
      error.status === 429
        ? 'Too many requests. Please wait a minute and try again.'
        : "We couldn't send the link. Please try again.";
    return { status: 'error', errors: { _form: message }, values };
  }
  return { status: 'success', message: parsed.data.email, values };
}

/** Onboarding: create a tenant (the caller becomes its owner) and open it. */
export async function createTenantAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const values = formValues(formData);
  const parsed = createTenantSchema.safeParse({ name: values.name ?? '', slug: values.slug ?? '' });
  if (!parsed.success) return { status: 'error', errors: fieldErrors(parsed.error), values };

  const { db } = await requireUser('/onboarding');
  try {
    await createTenant(db, parsed.data);
  } catch (e) {
    const message = userMessage(e);
    const field = e instanceof KittoError && e.isConflict ? 'slug' : '_form';
    return { status: 'error', errors: { [field]: message }, values };
  }
  redirect(tenantHref(parsed.data.slug));
}

/** Accept an invitation for the signed-in user, then open the tenant. */
export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const token = z.uuid().safeParse(formData.get('token'));
  if (!token.success) redirect('/');
  const { db } = await requireUser(`/invite/${token.data}`);

  let slug: string | undefined;
  let error: string | undefined;
  try {
    const tenantId = await acceptInvitation(db, token.data);
    slug = (await myTenants(db)).find((t) => t.tenant_id === tenantId)?.slug;
  } catch (e) {
    error = e instanceof KittoError && e.isPermissionDenied ? 'wrong_email' : 'invalid';
  }
  if (error || !slug) redirect(`/invite/${token.data}?error=${error ?? 'invalid'}`);
  redirect(tenantHref(slug));
}

/** Sign out from a form (alternative to POST /auth/signout). */
export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/');
}
