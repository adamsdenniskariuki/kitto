'use client';

import { useActionState, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { IDLE, type Database, type FormState } from '@kitto/core';
import { FormMessage, TextField, buttonClass } from '@kitto/ui';
import { createTenantAction, sendMagicLink } from './actions';

/** Supabase client for Client Components (e.g. Realtime subscriptions). */
export function createBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key)
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
  return createBrowserClient<Database>(url, key);
}

/** Magic-link sign-in form. `next` is where the emailed link lands after sign-in. */
export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(sendMagicLink, IDLE);

  if (state.status === 'success') {
    return (
      <div role="status" className="rounded-xl bg-brand-soft p-4 text-ink">
        <p className="font-semibold">Check your inbox</p>
        <p className="mt-1 text-sm">
          We sent a sign-in link to <strong>{state.message}</strong>. It expires in an hour.
        </p>
      </div>
    );
  }

  const errors = state.status === 'error' ? state.errors : {};
  return (
    <form action={action} noValidate className="space-y-4">
      {next && <input type="hidden" name="next" value={next} />}
      <TextField
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        placeholder="you@example.com"
        defaultValue={state.status === 'error' ? state.values?.email : undefined}
        error={errors.email}
      />
      <FormMessage error={errors._form} />
      <button type="submit" className={buttonClass('primary', 'md', 'w-full')} disabled={pending}>
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </button>
    </form>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}

/**
 * Create-a-workspace form: name plus a URL slug suggested from the name. The
 * address preview is `${addressPrefix}${slug}${addressSuffix}`, e.g.
 * "example.com/t/" + slug in path mode or slug + ".example.com" in subdomain mode.
 */
export function OnboardingForm({
  addressPrefix = '',
  addressSuffix = '',
}: {
  addressPrefix?: string;
  addressSuffix?: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createTenantAction, IDLE);
  const values = state.status === 'error' ? state.values : undefined;
  const [slug, setSlug] = useState(values?.slug ?? '');
  const [touched, setTouched] = useState(false);
  const errors = state.status === 'error' ? state.errors : {};

  return (
    <form action={action} noValidate className="space-y-4">
      <TextField
        label="Business name"
        name="name"
        required
        autoComplete="organization"
        defaultValue={values?.name}
        error={errors.name}
        onChange={(e) => {
          if (!touched) setSlug(slugify(e.target.value));
        }}
      />
      <TextField
        label="Web address"
        name="slug"
        required
        autoCapitalize="none"
        spellCheck={false}
        value={slug}
        onChange={(e) => {
          setTouched(true);
          setSlug(e.target.value.toLowerCase());
        }}
        hint={`${addressPrefix}${slug || 'your-business'}${addressSuffix}`}
        error={errors.slug}
      />
      <FormMessage error={errors._form} />
      <button type="submit" className={buttonClass('primary', 'md', 'w-full')} disabled={pending}>
        {pending ? 'Creating…' : 'Create workspace'}
      </button>
    </form>
  );
}
