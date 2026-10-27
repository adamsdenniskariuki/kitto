import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { parseFields, DEFAULT_FIELDS } from './fields.ts';
import { moduleNames } from './names.ts';
import * as t from './templates.ts';
import type { ModuleSpec } from './templates.ts';
import type * as Prettier from 'prettier';

export interface GenerateOptions {
  /** Repository root. */
  root: string;
  name: string;
  fields?: string | undefined;
  singular?: string | undefined;
  /** App to wire routes, nav and an e2e spec into, e.g. apps/demo. */
  app?: string | undefined;
  /** Override the migration version (tests). */
  timestamp?: string | undefined;
  now?: Date;
}

export interface PlannedFile {
  /** Path relative to the repository root, with forward slashes. */
  path: string;
  content: string;
  /** New file, or a patch to an existing one. */
  kind: 'create' | 'update';
}

export interface Plan {
  spec: ModuleSpec;
  files: PlannedFile[];
  warnings: string[];
}

const posix = (p: string) => p.split(sep).join('/');

/** UTC YYYYMMDDHHMMSS. */
export function migrationTimestamp(now: Date = new Date()): string {
  return now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

/** Every migration version already used under packages/, apps/ and supabase/. */
function existingVersions(root: string): Set<string> {
  const versions = new Set<string>();
  const dirs = [join(root, 'supabase', 'migrations')];
  for (const group of ['packages', 'apps']) {
    const base = join(root, group);
    if (!existsSync(base)) continue;
    for (const d of readdirSync(base)) dirs.push(join(base, d, 'supabase', 'migrations'));
  }
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const m = /^(\d{14})_/.exec(f);
      if (m) versions.add(m[1]!);
    }
  }
  return versions;
}

/** A version after every existing one (migrations must sort after the modules they build on). */
function nextVersion(root: string, wanted: string): string {
  const used = [...existingVersions(root)].sort();
  const latest = used.at(-1);
  let v = wanted;
  if (latest && v <= latest) v = latest;
  while (used.includes(v)) v = String(BigInt(v) + 1n);
  return v;
}

function tableExists(root: string, table: string): boolean {
  const types = join(root, 'packages', 'core', 'src', 'database.types.ts');
  if (!existsSync(types)) return false;
  return new RegExp(`^\\s{6}${table}: \\{$`, 'm').test(readFileSync(types, 'utf8'));
}

/** Work out every file to write, refusing names that clash with what exists. */
export function plan(opts: GenerateOptions): Plan {
  const { root } = opts;
  const names = moduleNames(opts.name, opts.singular);
  const fields = parseFields(opts.fields ?? DEFAULT_FIELDS);
  const pkgDir = `packages/${names.kebab}`;
  if (existsSync(join(root, pkgDir))) throw new Error(`${pkgDir} already exists.`);
  if (tableExists(root, names.snake))
    throw new Error(`A table called public.${names.snake} already exists.`);

  const timestamp = opts.timestamp ?? nextVersion(root, migrationTimestamp(opts.now ?? new Date()));
  const spec: ModuleSpec = { names, fields, timestamp };
  const files: PlannedFile[] = [];
  const warnings: string[] = [];
  const add = (path: string, content: string, kind: PlannedFile['kind'] = 'create') =>
    files.push({ path, content, kind });

  add(`${pkgDir}/package.json`, t.packageJson(spec));
  add(`${pkgDir}/tsconfig.json`, t.tsconfigJson());
  add(`${pkgDir}/supabase/migrations/${timestamp}_${names.snake}.sql`, t.migrationSql(spec));
  add(`${pkgDir}/supabase/tests/${names.snake}_test.sql`, t.pgtapSql(spec));
  add(`${pkgDir}/src/permissions.ts`, t.permissionsTs(spec));
  add(`${pkgDir}/src/schemas.ts`, t.schemasTs(spec));
  add(`${pkgDir}/src/data.ts`, t.dataTs(spec));
  add(`${pkgDir}/src/shared.ts`, t.sharedTs(spec));
  add(`${pkgDir}/src/actions.ts`, t.actionsTs(spec));
  add(`${pkgDir}/src/pages.tsx`, t.pagesTsx(spec));
  add(`${pkgDir}/src/index.ts`, t.indexTs());
  add(`${pkgDir}/src/${names.kebab}.test.ts`, t.unitTestTs(spec));

  if (opts.app) planApp(root, posix(opts.app).replace(/\/$/, ''), spec, add, warnings);
  return { spec, files, warnings };
}

function planApp(
  root: string,
  app: string,
  spec: ModuleSpec,
  add: (path: string, content: string, kind?: PlannedFile['kind']) => void,
  warnings: string[],
) {
  const { names } = spec;
  const appRoot = join(root, app);
  if (!existsSync(join(appRoot, 'package.json'))) throw new Error(`${app} is not an app folder.`);
  const routes = `${app}/src/app/t/[tenant]/${names.kebab}`;
  if (existsSync(join(root, routes))) throw new Error(`${routes} already exists.`);
  const pkg = `@kitto/${names.kebab}`;

  add(`${routes}/page.tsx`, t.appListRoute(spec));
  add(`${routes}/new/page.tsx`, t.appNewRoute(spec));
  add(`${routes}/[id]/page.tsx`, t.appDetailRoute(spec));
  if (existsSync(join(appRoot, 'e2e'))) add(`${app}/e2e/${names.kebab}.spec.ts`, t.e2eSpec(spec));

  // package.json dependency (kept sorted, as pnpm writes it).
  const pkgPath = `${app}/package.json`;
  const appPkg = JSON.parse(readFileSync(join(root, pkgPath), 'utf8')) as {
    dependencies?: Record<string, string>;
  };
  const deps = { ...appPkg.dependencies, [pkg]: 'workspace:*' };
  appPkg.dependencies = Object.fromEntries(
    Object.entries(deps).sort(([a], [b]) => a.localeCompare(b)),
  );
  add(pkgPath, `${JSON.stringify(appPkg, null, 2)}\n`, 'update');

  // next.config: Kitto packages ship TypeScript source, so Next must transpile them.
  const configName = ['next.config.ts', 'next.config.mjs', 'next.config.js'].find((f) =>
    existsSync(join(appRoot, f)),
  );
  if (configName) {
    const src = readFileSync(join(appRoot, configName), 'utf8');
    const patched = src.replace(
      /(transpilePackages:\s*\[[\s\S]*?)(,?)(\s*)\]/,
      (_m, list: string, comma: string, space: string) =>
        `${list}${comma || ','}${space.replace(/\n(\s*)$/, '\n$1  ')}'${pkg}',${space}]`,
    );
    if (patched === src)
      warnings.push(`Add '${pkg}' to transpilePackages in ${app}/${configName}.`);
    else add(`${app}/${configName}`, patched, 'update');
  } else warnings.push(`No next.config found in ${app}; add '${pkg}' to transpilePackages.`);

  // Tenant layout: import the nav helper and list it in the main nav.
  const layoutPath = `${app}/src/app/t/[tenant]/layout.tsx`;
  const nav = `${names.camel}Nav`;
  if (existsSync(join(root, layoutPath))) {
    let src = readFileSync(join(root, layoutPath), 'utf8');
    const imports = [...src.matchAll(/^import [^;]+;\n/gm)];
    const navList = /(const nav: NavItem\[\] = \[[\s\S]*?)(\n\s*)\];/;
    if (imports.length && navList.test(src)) {
      const last = imports.at(-1)!;
      const at = last.index + last[0].length;
      src = `${src.slice(0, at)}import { ${nav} } from '${pkg}';\n${src.slice(at)}`;
      src = src.replace(
        navList,
        (_m, list: string, space: string) =>
          `${list}${space.replace(/\n(\s*)$/, '\n$1  ')}...${nav}(ctx),${space}];`,
      );
      add(layoutPath, src, 'update');
    } else warnings.push(`Add ...${nav}(ctx) to the nav in ${layoutPath}.`);
  } else warnings.push(`No ${layoutPath}; add ...${nav}(ctx) to your app's nav.`);
}

/** Format TypeScript/JSON with the repository's Prettier config (SQL is left as written). */
export async function formatFiles(root: string, files: PlannedFile[]): Promise<PlannedFile[]> {
  let prettier: typeof Prettier | undefined;
  try {
    prettier = await import('prettier');
  } catch {
    return files;
  }
  const out: PlannedFile[] = [];
  for (const f of files) {
    if (!/\.(tsx?|json)$/.test(f.path)) {
      out.push(f);
      continue;
    }
    const filepath = join(root, f.path);
    const options = (await prettier.resolveConfig(filepath)) ?? {};
    out.push({ ...f, content: await prettier.format(f.content, { ...options, filepath }) });
  }
  return out;
}

export function writeFiles(root: string, files: PlannedFile[]): void {
  for (const f of files) {
    const target = join(root, ...f.path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.content);
  }
}

export function describePlan(root: string, p: Plan): string {
  return p.files
    .map((f) => `  ${f.kind === 'create' ? '+' : '~'} ${posix(relative(root, join(root, f.path)))}`)
    .join('\n');
}
