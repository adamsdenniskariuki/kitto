import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFields, titleField } from './fields.ts';
import { migrationTimestamp, plan } from './generate.ts';
import { moduleNames, singularize, validateModuleName } from './names.ts';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

describe('module names', () => {
  it('derives every spelling from kebab or snake case', () => {
    expect(moduleNames('ci-widgets')).toMatchObject({
      kebab: 'ci-widgets',
      snake: 'ci_widgets',
      camel: 'ciWidgets',
      pascal: 'CiWidgets',
      singularCamel: 'ciWidget',
      singularPascal: 'CiWidget',
      singularConst: 'CI_WIDGET',
      title: 'Ci widgets',
      singularLower: 'ci widget',
    });
    expect(moduleNames('fleet_vehicles').kebab).toBe('fleet-vehicles');
    expect(moduleNames('Vehicles').snake).toBe('vehicles');
  });

  it('singularises the last word', () => {
    expect(singularize('vehicles')).toBe('vehicle');
    expect(singularize('categories')).toBe('category');
    expect(singularize('boxes')).toBe('box');
    expect(singularize('branches')).toBe('branch');
    expect(singularize('status')).toBe('status');
    expect(moduleNames('people', 'person').singularPascal).toBe('Person');
  });

  it.each(['', '1things', 'my things', 'things-', 'a--b', 'émigrés', 'x'.repeat(41)])(
    'rejects %j',
    (name) => expect(() => validateModuleName(name)).toThrow(),
  );

  it.each(['customers', 'orders', 'reports', 'tenants', 'users', 'select', 'audit_log', 'api'])(
    'rejects reserved name %s',
    (name) => expect(() => validateModuleName(name)).toThrow(/reserved/),
  );

  it('needs a distinct singular', () => {
    expect(() => moduleNames('sheep')).toThrow(/singular/);
    expect(moduleNames('sheep', 'sheep-item').singularPascal).toBe('SheepItem');
  });
});

describe('field specs', () => {
  it('parses types, required flags and columns', () => {
    const fields = parseFields(
      'make:text! year:int purchase_price:money active:bool notes:longtext',
    );
    expect(fields.map((f) => [f.name, f.type, f.required, f.column, f.label])).toEqual([
      ['make', 'text', true, 'make', 'Make'],
      ['year', 'int', false, 'year', 'Year'],
      ['purchase_price', 'money', false, 'purchase_price_minor', 'Purchase price'],
      ['active', 'bool', true, 'active', 'Active'],
      ['notes', 'longtext', false, 'notes', 'Notes'],
    ]);
    expect(titleField(fields).name).toBe('make');
  });

  it('defaults to a name and notes', () => {
    expect(parseFields().map((f) => f.name)).toEqual(['name', 'notes']);
  });

  it.each([
    ['name:text! year:integer', /Unknown type/],
    ['name:text! Year:int', /Bad field/],
    ['name', /Bad field/],
    ['name:text! id:int', /reserved/],
    ['name:text! tenant_id:text', /reserved/],
    ['name:text! name:int', /clashes/],
    ['price:money! price_minor:int name:text!', /clashes/],
    ['notes:longtext year:int', /required text field/],
    ['name:text! bad__name:int', /underscore/],
  ])('rejects %j', (spec, error) => expect(() => parseFields(spec)).toThrow(error));
});

describe('plan (dry run)', () => {
  const p = plan({
    root: ROOT,
    name: 'ci-gadgets',
    fields: 'name:text! qty:int price:money',
    app: 'apps/demo',
    timestamp: '20991231000000',
  });
  const file = (path: string) => p.files.find((f) => f.path === path)?.content ?? '';

  it('lists the package, SQL, tests and app wiring', () => {
    expect(p.files.map((f) => `${f.kind} ${f.path}`)).toEqual([
      'create packages/ci-gadgets/package.json',
      'create packages/ci-gadgets/tsconfig.json',
      'create packages/ci-gadgets/supabase/migrations/20991231000000_ci_gadgets.sql',
      'create packages/ci-gadgets/supabase/tests/ci_gadgets_test.sql',
      'create packages/ci-gadgets/src/permissions.ts',
      'create packages/ci-gadgets/src/schemas.ts',
      'create packages/ci-gadgets/src/data.ts',
      'create packages/ci-gadgets/src/shared.ts',
      'create packages/ci-gadgets/src/actions.ts',
      'create packages/ci-gadgets/src/pages.tsx',
      'create packages/ci-gadgets/src/index.ts',
      'create packages/ci-gadgets/src/ci-gadgets.test.ts',
      'create apps/demo/src/app/t/[tenant]/ci-gadgets/page.tsx',
      'create apps/demo/src/app/t/[tenant]/ci-gadgets/new/page.tsx',
      'create apps/demo/src/app/t/[tenant]/ci-gadgets/[id]/page.tsx',
      'create apps/demo/e2e/ci-gadgets.spec.ts',
      'update apps/demo/package.json',
      'update apps/demo/next.config.ts',
      'update apps/demo/src/app/t/[tenant]/layout.tsx',
    ]);
    expect(p.warnings).toEqual([]);
  });

  it('writes a tenant-scoped table with RLS, permissions and audit', () => {
    const sql = file('packages/ci-gadgets/supabase/migrations/20991231000000_ci_gadgets.sql');
    expect(sql).toMatch(
      /tenant_id\s+uuid not null references public\.tenants \(id\) on delete cascade/,
    );
    expect(sql).toContain('unique (tenant_id, id)');
    expect(sql).toMatch(/price_minor\s+bigint check \(price_minor >= 0\)/);
    expect(sql).toContain("select private.register_permission('ci_gadgets.view', 'ci-gadgets'");
    expect(sql).toContain("select private.enable_audit('public.ci_gadgets');");
    expect(sql).toContain('alter table public.ci_gadgets enable row level security;');
    expect(sql).toContain(
      "using (tenant_id in (select private.permitted_tenant_ids('ci_gadgets.delete')));",
    );
    expect(sql).toContain('grant insert (tenant_id, name, qty, price_minor)');
  });

  it('patches the app', () => {
    expect(file('apps/demo/src/app/t/[tenant]/layout.tsx')).toMatch(
      /import \{ ciGadgetsNav \} from '@kitto\/ci-gadgets';[\s\S]*\.\.\.ciGadgetsNav\(ctx\),\n {2}\];/,
    );
    expect(file('apps/demo/next.config.ts')).toContain("'@kitto/ci-gadgets',");
    expect(JSON.parse(file('apps/demo/package.json')).dependencies['@kitto/ci-gadgets']).toBe(
      'workspace:*',
    );
  });

  it('converts money in data access and names things like customers does', () => {
    expect(file('packages/ci-gadgets/src/data.ts')).toContain(
      'price_minor: input.price === null ? null : toMinorUnits(input.price, currency),',
    );
    expect(file('packages/ci-gadgets/src/permissions.ts')).toContain(
      "export const CI_GADGET_PERMISSIONS = {\n  view: 'ci_gadgets.view',",
    );
    expect(file('packages/ci-gadgets/src/pages.tsx')).toContain(
      'export async function CiGadgetsPage(',
    );
  });

  it('refuses names that already exist', () => {
    expect(() => plan({ root: ROOT, name: 'customers' })).toThrow();
    expect(() => plan({ root: ROOT, name: 'customer-notes' })).toThrow(/already exists/);
  });
});

describe('migrationTimestamp', () => {
  it('formats UTC as YYYYMMDDHHMMSS', () => {
    expect(migrationTimestamp(new Date('2026-10-27T08:09:10.123Z'))).toBe('20261027080910');
  });
});
