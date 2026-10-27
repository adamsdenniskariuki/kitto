/**
 * pnpm generator:check — prove generated modules pass CI.
 *
 * Generates a scratch module into the repo (wired into apps/demo), then runs
 * what CI runs on it: install, SQL sync, database reset, type generation,
 * Prettier, ESLint, typecheck, Vitest, pgTAP, the database linter, a demo
 * build and the generated Playwright spec. Afterwards everything is removed,
 * patched files are restored and the database is reset again, so the working
 * tree ends as it started.
 *
 *   --name <name>      Scratch module name (default ci-widgets).
 *   --fields "<spec>"  Field spec (default covers every field type).
 *   --skip-e2e         Skip the demo build and Playwright run.
 *   --keep             Leave the generated module in place (no cleanup).
 *   --no-db-cleanup    Clean up files but skip the final database reset (CI throws the DB away).
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { moduleNames } from './names.ts';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
const APP = 'apps/demo';
const DEFAULT_FIELDS =
  'name:text! code:text qty:int! weight:numeric price:money! active:bool due_on:date notes:longtext';

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    name: { type: 'string', default: 'ci-widgets' },
    fields: { type: 'string', default: DEFAULT_FIELDS },
    'skip-e2e': { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
    'no-db-cleanup': { type: 'boolean', default: false },
  },
});

const names = moduleNames(values.name);
const pkg = `@kitto/${names.kebab}`;

/** Files the generator or the checks change, restored byte-for-byte afterwards. */
const SNAPSHOT = [
  `${APP}/package.json`,
  `${APP}/next.config.ts`,
  `${APP}/src/app/t/[tenant]/layout.tsx`,
  'pnpm-lock.yaml',
  'packages/core/src/database.types.ts',
];
/** Paths the generator creates. */
const GENERATED = [
  `packages/${names.kebab}`,
  `${APP}/src/app/t/[tenant]/${names.kebab}`,
  `${APP}/e2e/${names.kebab}.spec.ts`,
];

const abs = (p: string) => join(ROOT, ...p.split('/'));

function run(cmd: string, cwd = ROOT, env: Record<string, string> = {}) {
  console.log(`\n▶ ${cmd}${cwd === ROOT ? '' : `   (in ${cwd.slice(ROOT.length + 1)})`}`);
  execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
}

for (const p of GENERATED)
  if (existsSync(abs(p))) throw new Error(`${p} already exists; remove it or pick another --name.`);

const saved = new Map(
  SNAPSHOT.filter((p) => existsSync(abs(p))).map((p) => [p, readFileSync(abs(p))]),
);
const started = Date.now();
let failed = false;

try {
  run(
    `node --experimental-strip-types --no-warnings=ExperimentalWarning tools/create-kitto-module/src/cli.ts ${names.kebab} --fields "${values.fields}" --app ${APP}`,
  );
  run('pnpm install --no-frozen-lockfile --prefer-offline');
  run('pnpm db:sync');
  run('pnpm db:reset');
  run('pnpm db:types');
  run('pnpm db:sync:check');

  const touched = [...GENERATED, ...SNAPSHOT.filter((p) => p.startsWith(APP))]
    .map((p) => `"${p}"`)
    .join(' ');
  run(`pnpm exec prettier --check ${touched}`);
  run(`pnpm exec eslint ${GENERATED.map((p) => `"${p}"`).join(' ')} "${APP}/src"`);
  run(`pnpm --filter ${pkg} typecheck`);
  run(`pnpm --filter ${pkg} test`);
  run(`pnpm --filter @kitto/demo typecheck`);
  run('pnpm db:test');
  run('pnpm db:lint');

  if (!values['skip-e2e']) {
    run('pnpm --filter @kitto/demo build');
    run(
      `pnpm exec playwright test e2e/${names.kebab}.spec.ts --retries=0 --reporter=line`,
      abs(APP),
      {
        CI: '1',
      },
    );
  }
  console.log(`\n✔ Generated module ${pkg} passed every check.`);
} catch (e) {
  failed = true;
  console.error(`\n✘ generator check failed: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (values.keep) {
    console.log(`\n--keep: left ${pkg} in place.`);
  } else {
    console.log('\nCleaning up…');
    for (const p of GENERATED) rmSync(abs(p), { recursive: true, force: true });
    for (const [p, content] of saved) writeFileSync(abs(p), content);
    try {
      run('pnpm install --frozen-lockfile --prefer-offline');
      run('pnpm db:sync');
      if (!values['no-db-cleanup']) run('pnpm db:reset');
    } catch (e) {
      failed = true;
      console.error(`Cleanup failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`\nFinished in ${Math.round((Date.now() - started) / 1000)}s.`);
}

process.exit(failed ? 1 : 0);
