# Setup and deployment

This guide covers running Kitto locally, creating the hosted Supabase project, and deploying an app (such as `apps/demo`) to Vercel. M-Pesa (Daraja) setup is added with the `mpesa` module.

## 1. Local development

Prerequisites: Node 22, pnpm 10, and Docker (Supabase runs locally in containers).

```bash
pnpm install
pnpm db:start                         # local Supabase on ports 553xx
pnpm exec supabase status             # prints API URL and anon key
cp .env.example apps/demo/.env.local  # then paste the anon key into it
pnpm --filter @kitto/demo dev         # http://localhost:3000
```

- **Emails are not sent locally.** Supabase catches them in Mailpit at http://127.0.0.1:55324. Sign in with any address, then open Mailpit and click the link.
- Kitto's local ports (`55321` API, `55322` DB, `55324` Mailpit) are offset from the Supabase defaults, so Kitto can run next to other Supabase projects.
- `pnpm db:reset` rebuilds the database from migrations. After changing a package's SQL, run `pnpm db:sync` (copies it into `supabase/`) and `pnpm db:types` (regenerates TypeScript types). CI fails if you forget either.

### Tests

| Command                                   | What it runs                                                      |
| ----------------------------------------- | ----------------------------------------------------------------- |
| `pnpm db:test`                            | pgTAP: RLS, tenant isolation, permissions, audit                  |
| `pnpm test`                               | Vitest unit tests in every package                                |
| `pnpm --filter @kitto/demo build`         | Production build (needed before the e2e run below)                |
| `CI=1 pnpm --filter @kitto/demo test:e2e` | Playwright on phone and desktop, plus the axe accessibility sweep |

Without `CI=1`, Playwright starts `next dev`. That works but is slow on the first compile of each page.

### Tenant URLs: path or subdomain

| Mode             | `.env.local`                                                                                                          | Open                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `path` (default) | `NEXT_PUBLIC_TENANT_MODE=path`                                                                                        | `http://localhost:3000/t/acme` |
| `subdomain`      | `NEXT_PUBLIC_TENANT_MODE=subdomain`, `NEXT_PUBLIC_ROOT_DOMAIN=lvh.me:3000`, `NEXT_PUBLIC_SITE_URL=http://lvh.me:3000` | `http://acme.lvh.me:3000`      |

To test subdomain mode locally, use `lvh.me` rather than `localhost`. `lvh.me` and all its subdomains resolve to 127.0.0.1, and browsers will share a session cookie across `*.lvh.me` but not across `*.localhost`. `supabase/config.toml` already allows these redirect URLs. Restart Supabase (`pnpm db:stop && pnpm db:start`) after editing that file.

## 2. Supabase project

1. In https://supabase.com/dashboard, choose **New project**. Pick the region closest to your users (for Kenya, `eu-central-1` Frankfurt or `eu-west-1` Ireland). Save the database password in your password manager.
2. **Project Settings → API**:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / publishable key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`. This is safe in the browser, because RLS protects the data.
   - **service_role / secret key** → `SUPABASE_SERVICE_ROLE_KEY`. Server only. Never expose or commit it.
3. **Authentication → URL Configuration**:
   - **Site URL**: your production URL, e.g. `https://app.example.com`.
   - **Redirect URLs**: `https://app.example.com/**`, your Vercel preview pattern (e.g. `https://*-yourteam.vercel.app/**`) and `http://localhost:3000/**`. In subdomain mode, also add `https://*.example.com/**`.
4. **Authentication → Emails → Templates**: set both **Magic Link** and **Confirm signup** to the HTML in [`supabase/templates/magic_link.html`](../supabase/templates/magic_link.html). Its link goes to `/auth/confirm?token_hash=…`, which works in any browser. Invitations need this, because the owner requests the email and the invitee opens it on a different device. The default templates use PKCE links, which only work in the browser that asked for them.
5. For real email volume, configure custom SMTP under **Authentication → Emails → SMTP Settings**. The built-in sender is heavily rate-limited.

### Apply the migrations

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <project-ref>   # prompts for the DB password
pnpm exec supabase db push --dry-run                  # review
pnpm exec supabase db push
```

Migrations are append-only. To change the schema, add a new migration in the owning package (`packages/<pkg>/supabase/migrations/`) and run `pnpm db:sync`. Never edit a migration that has already been applied.

## 3. Vercel

1. https://vercel.com/new → import the repository.
2. **Root Directory**: `apps/demo` (or your app's folder). Vercel detects pnpm workspaces and Next.js; keep the default build and install commands.
3. Add the environment variables below for **Production** and **Preview**.
4. Deploy. Every PR gets a preview URL, and `main` deploys to production.

**Subdomain mode:** add a wildcard domain (`*.example.com`) to the project. Vercel needs to manage the domain's nameservers to issue wildcard certificates. Set `NEXT_PUBLIC_ROOT_DOMAIN=example.com`. The session cookie is then scoped to `.example.com`, so one sign-in covers every tenant subdomain.

## 4. Environment variables

`NEXT_PUBLIC_*` values are compiled into the browser bundle; everything else is server-only. [`.env.example`](../.env.example) mirrors this table and holds placeholders only.

| Name                            | Value                                                                                 | Public / secret |
| ------------------------------- | ------------------------------------------------------------------------------------- | --------------- |
| `NEXT_PUBLIC_SITE_URL`          | `https://app.example.com` (locally `http://localhost:3000`)                           | Public          |
| `NEXT_PUBLIC_TENANT_MODE`       | `path` or `subdomain`                                                                 | Public          |
| `NEXT_PUBLIC_ROOT_DOMAIN`       | Subdomain mode only: `example.com` (locally `lvh.me:3000`)                            | Public          |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase → Project Settings → API (locally from `supabase status`)                    | Public          |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API keys → anon / publishable                                              | Public          |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase → API keys → service_role. Used by trusted server jobs and payment callbacks | **Secret**      |
| `MAILPIT_URL`                   | Tests only: local Mailpit, `http://127.0.0.1:55324`                                   | n/a             |

## 5. GitHub Actions

CI needs **no secrets**. It starts an ephemeral local Supabase stack, applies every migration from scratch, runs pgTAP, unit tests and the build, and then runs Playwright and axe against the demo app.
