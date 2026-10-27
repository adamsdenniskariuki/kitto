# create-kitto-module

Scaffolds a Kitto business module, from the table and its RLS through to forms, pages and tests. The output follows the conventions of `@kitto/customers` exactly, so it passes the same CI as hand-written modules. CI proves this on every push (see [Proof in CI](#proof-in-ci)).

```bash
pnpm create-kitto-module vehicles \
  --fields "make:text! model:text! year:int price:money notes:longtext" \
  --app apps/demo
pnpm install && pnpm db:sync && pnpm db:reset && pnpm db:types   # or pass --apply
pnpm --filter @kitto/vehicles test && pnpm db:test
```

## Options

| Option              | Meaning                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `<name>`            | Plural module name in kebab or snake case (`vehicles`, `fleet-vehicles`), up to 40 characters.            |
| `--fields "<spec>"` | Space- or comma-separated `name:type`, with `!` for required. Default `name:text! notes:longtext`.        |
| `--app <dir>`       | Also wire the module into an app: routes, nav, `transpilePackages`, the dependency and a Playwright spec. |
| `--singular <word>` | Singular form when the guess is wrong (`people --singular person`).                                       |
| `--dry-run`         | Print the files that would be created or updated, and write nothing.                                      |
| `--apply`           | Afterwards run `pnpm install`, `db:sync`, `db:reset` and `db:types`.                                      |

Field types:

| Type       | Column                           | Form input                    |
| ---------- | -------------------------------- | ----------------------------- |
| `text`     | `text`, 1-200 characters         | text                          |
| `longtext` | `text`, up to 2000 characters    | textarea                      |
| `int`      | `integer`                        | number                        |
| `numeric`  | `numeric(14, 4)`                 | decimal                       |
| `money`    | `<name>_minor bigint` (≥ 0)      | amount in the tenant currency |
| `bool`     | `boolean not null default false` | checkbox                      |
| `date`     | `date`                           | date                          |

At least one field must be a required text field. The first one names each record: it is used in lists, search, headings and the audit trail. The generator refuses invalid or reserved names (existing packages, core tables, SQL keywords), reserved column names (`id`, `tenant_id`, `created_at`, …), and modules whose package, table or route already exists.

## What it writes

For `vehicles` (singular `vehicle`):

```
packages/vehicles/
  package.json, tsconfig.json             exports "." and "./actions", like customers
  supabase/migrations/<utc>_vehicles.sql  table, checks, updated_at trigger, column grants,
                                          RLS, permissions, audit
  supabase/tests/vehicles_test.sql        pgTAP: RLS on, permissions, roles, cross-tenant
                                          isolation, client-unwritable columns, audit, anon
  src/permissions.ts                      VEHICLE_PERMISSIONS
  src/schemas.ts                          vehicleFormSchema (Zod) → VehicleInput
  src/data.ts                             listVehicles, getVehicle, create/update/deleteVehicle
  src/shared.ts                           VEHICLE_NOTICES / VEHICLE_ERRORS, error mapper, vehiclesNav
  src/actions.ts                          'use server' create/update/delete via runTenantAction
  src/pages.tsx                           VehiclesPage (search, paging), NewVehiclePage,
                                          VehicleDetailPage (edit + delete)
  src/vehicles.test.ts                    Vitest for the schema and error mapping
```

With `--app apps/demo` it also writes `src/app/t/[tenant]/vehicles/{page,new/page,[id]/page}.tsx` and `e2e/vehicles.spec.ts` (add, search, edit, delete). It patches `package.json`, `next.config.ts` and `src/app/t/[tenant]/layout.tsx`, and prints a warning if one of them doesn't have the expected shape.

- **Migration timestamp:** the current UTC time, bumped past the newest existing migration so it sorts after every module block.
- **Permissions:** `vehicles.view`, `vehicles.create`, `vehicles.edit`, `vehicles.delete`. Defaults: view for manager, front_desk, sales and viewer; create and edit for manager, front_desk and sales; delete for manager. Owners hold everything. To change these, edit the `register_permission` calls before you first apply the migration, then keep `permissions.ts` in step.
- **Database types:** `data.ts` uses the generated `Database` types, so the package typechecks once `pnpm db:types` has picked up the new table.

TypeScript output is formatted with the repo's Prettier config. SQL is written already formatted.

## Proof in CI

`pnpm generator:check` (the CI `generator` job) generates a scratch module `ci-widgets` with every field type into `apps/demo`, then runs the following against it:

1. `pnpm install`, `db:sync`, `db:reset`, `db:types`, `db:sync:check`
2. Prettier check and ESLint on everything it touched
3. Typecheck and Vitest for the package, typecheck for the demo
4. `db:test` (all pgTAP, including the generated test) and `db:lint`
5. The demo build and the generated Playwright spec

Finally it deletes the generated files, restores the patched files, reinstalls and resets the database. Options: `--name`, `--fields`, `--skip-e2e`, `--keep` (leave the output for debugging) and `--no-db-cleanup`.

## Development

```bash
pnpm --filter @kitto/create-kitto-module test       # names, fields, dry-run plan
pnpm create-kitto-module things --dry-run --app apps/demo
```

The tool is plain TypeScript run by Node 22's `--experimental-strip-types`, with no build step and no runtime dependencies beyond Node and Prettier. Templates are in `src/templates.ts`. If you change a module convention in `packages/customers`, change the templates too. `generator:check` will tell you if they drift.
