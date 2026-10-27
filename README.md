# Kitto

**Kitto** (kit + to) is a reusable framework for multi-tenant business apps, built on Next.js (App Router), strict TypeScript and Supabase (Postgres, Row Level Security, Realtime). It packages the parts every business app needs, such as tenants, staff roles, customers, bookings, billing, M-Pesa, stock and orders, so a new app like a hotel system or a car dealership is mostly configuration and a few screens.

```mermaid
flowchart LR
  subgraph Apps
    hotel[Hotel app]
    dealer[Car dealership app]
    demo[apps/demo]
  end
  subgraph Kitto packages
    core & auth & ui & admin
    customers & booking & billing & mpesa
    inventory & orders & reports
  end
  Apps --> core & auth & ui & admin
  Apps -. opt in .-> customers & booking & billing & mpesa & inventory & orders & reports
  core & customers & booking & billing & mpesa & inventory & orders & reports --> db[(Supabase Postgres + RLS)]
```

## Status

| Step | Scope                                                                         | State   |
| ---- | ----------------------------------------------------------------------------- | ------- |
| 1    | Monorepo, CI, database core (tenants, members, roles/permissions, RLS, audit) | ✅      |
| 2    | auth, ui kit, admin portal shell                                              | ✅      |
| 3    | customers, booking                                                            | ✅      |
| 4    | billing, mpesa                                                                | ✅      |
| 5    | inventory, orders                                                             | ✅      |
| 6    | reports, module generator                                                     | ✅      |
| 7    | demo app, docs and tutorial                                                   | planned |

## Layout

```
supabase/          generated: every module's migrations + pgTAP tests (pnpm db:sync)
packages/
  core             tenants, members, roles & permissions, audit log, formatting
  auth             magic-link sign-in, proxy (tenant resolution), invitations, tenant switcher
  ui               themed, accessible components; dark mode; forms; data tables
  admin            admin portal pages: staff, roles, settings, audit log
  ...              one package per module (see docs/ARCHITECTURE.md)
tools/             create-kitto-module generator
apps/demo          example app using every module
docs/              architecture, setup, tutorial
scripts/           sync-sql, gen-types
```

## Quick start

Prerequisites: Node 22, pnpm 10, Docker (for local Supabase).

```bash
pnpm install
pnpm db:start        # local Supabase on ports 553xx (avoids clashing with other projects)
pnpm db:test         # pgTAP: RLS, tenant isolation, permissions, audit
pnpm test            # unit tests
cp .env.example apps/demo/.env.local   # add the anon key from `pnpm exec supabase status`
pnpm --filter @kitto/demo dev          # http://localhost:3000; sign-in emails land in Mailpit (:55324)
```

See [docs/SETUP.md](docs/SETUP.md) for subdomain mode, e2e tests, hosted Supabase, Vercel and M-Pesa (Daraja). Locally, `MPESA_ENV=mock` (the `.env.example` default) makes M-Pesa requests settle themselves a second later without touching Safaricom.

Common scripts:

| Script                             | What it does                                                              |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `pnpm db:sync`                     | Copy each package's `supabase/{migrations,tests}` into root `supabase/`   |
| `pnpm db:reset`                    | Rebuild the local database from migrations                                |
| `pnpm db:lint`                     | `supabase db lint`                                                        |
| `pnpm db:types`                    | Regenerate `packages/core/src/database.types.ts`                          |
| `pnpm typecheck` / `lint` / `test` | Across all packages via Turborepo                                         |
| `pnpm create-kitto-module <name>`  | Scaffold a new module (see below)                                         |
| `pnpm generator:check`             | Generate a scratch module and prove it passes every check, then remove it |

## Create a module

```bash
pnpm create-kitto-module vehicles --fields "make:text! model:text! year:int price:money notes:longtext" --app apps/demo
pnpm install && pnpm db:sync && pnpm db:reset && pnpm db:types   # or add --apply
```

This writes `packages/vehicles` the same shape as `@kitto/customers`: a migration (tenant-scoped table, RLS, `vehicles.view/create/edit/delete` permissions, audit, column grants), a pgTAP test, Zod schemas, typed data access, server actions, list/new/detail pages and a Vitest file. With `--app` it also adds the routes, nav entry, `transpilePackages` entry, dependency and a Playwright spec. Use `--dry-run` to see the file list first. See [tools/create-kitto-module](tools/create-kitto-module/README.md).

## Key ideas

- **Tenant isolation lives in the database.** Every tenant-owned table has `tenant_id` and RLS policies driven by `has_permission(tenant_id, 'module.action')`. pgTAP tests prove one tenant cannot read or write another's rows.
- **Roles are data.** Seven default roles are seeded per tenant (owner, manager, front_desk, waiter, storekeeper, sales, viewer), and tenants can add their own. Owners hold every permission and the last owner cannot be removed, disabled or demoted.
- **Everything important is audited** by one generic trigger that records who, what, when, and the before and after values.
- **Modules are opt-in.** Each package owns ordered, append-only migrations, typed data access, Zod schemas, UI and tests.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and diagrams.
