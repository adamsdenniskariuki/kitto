#!/usr/bin/env node
/**
 * pnpm create-kitto-module <name> [--fields "..."] [--app apps/demo] [--singular x]
 *                                  [--dry-run] [--apply]
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FIELD_TYPES, DEFAULT_FIELDS } from './fields.ts';
import { describePlan, formatFiles, plan, writeFiles } from './generate.ts';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const USAGE = `Usage: pnpm create-kitto-module <name> [options]

Scaffolds packages/<name>: a tenant-scoped table with RLS, permissions and
audit; Zod schema; data access; server actions; list/new/detail pages; and
Vitest + pgTAP (+ Playwright with --app) tests.

Options:
  --fields "<spec>"   Fields as name:type, "!" for required (default "${DEFAULT_FIELDS}").
                      Types: ${FIELD_TYPES.join(', ')}.
                      The first required text field names each record.
  --app <dir>         Wire routes, nav, dependency and an e2e spec into an app (e.g. apps/demo).
  --singular <word>   Singular form when the guess is wrong (e.g. --singular person).
  --dry-run           List the files that would be written, write nothing.
  --apply             Afterwards run pnpm install, db:sync, db:reset and db:types.
  -h, --help          Show this help.

Example:
  pnpm create-kitto-module vehicles --fields "make:text! model:text! year:int price:money notes:longtext" --app apps/demo`;

const NEXT_STEPS = ['pnpm install', 'pnpm db:sync', 'pnpm db:reset', 'pnpm db:types'] as const;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      fields: { type: 'string' },
      app: { type: 'string' },
      singular: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(USAGE);
    return values.help ? 0 : 1;
  }

  const p = plan({
    root: ROOT,
    name: positionals[0]!,
    fields: values.fields,
    singular: values.singular,
    app: values.app,
  });
  const { names } = p.spec;

  if (values['dry-run']) {
    console.log(`Would write @kitto/${names.kebab} (dry run):\n${describePlan(ROOT, p)}`);
    for (const w of p.warnings) console.warn(`! ${w}`);
    return 0;
  }

  writeFiles(ROOT, await formatFiles(ROOT, p.files));
  console.log(`Created @kitto/${names.kebab}:\n${describePlan(ROOT, p)}`);
  for (const w of p.warnings) console.warn(`! ${w}`);
  console.log(
    `\nPermissions: ${['view', 'create', 'edit', 'delete'].map((k) => `${names.snake}.${k}`).join(', ')}`,
  );

  if (values.apply) {
    for (const cmd of NEXT_STEPS) {
      console.log(`\n$ ${cmd}`);
      execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
    }
    console.log('\nDone. Run pnpm typecheck, pnpm test and pnpm db:test to check it.');
  } else {
    console.log(
      `\nNext steps (or rerun with --apply):\n${NEXT_STEPS.map((c) => `  ${c}`).join('\n')}\n` +
        '  pnpm typecheck && pnpm test && pnpm db:test',
    );
  }
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`create-kitto-module: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
