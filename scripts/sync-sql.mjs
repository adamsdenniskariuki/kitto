#!/usr/bin/env node
// Copies each module's SQL (packages/<module>/supabase/{migrations,tests}/*.sql)
// into the root supabase/ folder, which is what the Supabase CLI reads.
//
//   node scripts/sync-sql.mjs          write the copies
//   node scripts/sync-sql.mjs --check  fail if the copies are missing or stale (CI)
//
// Migration file names start with a 14-digit timestamp. Every module owns a
// block of timestamps (core = 20260101..., customers = 20260102..., ...), so the
// global order is stable no matter which modules an app enables. Migrations are
// append-only: never edit one that has shipped, add a new file instead.
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const KINDS = ['migrations', 'tests'];
const NAME = {
  migrations: /^[0-9]{14}_[a-z0-9_]+\.sql$/,
  tests: /^[a-z0-9_]+_test\.sql$/,
};

const problems = [];
for (const kind of KINDS) {
  const wanted = new Map();
  for (const base of ['packages', 'apps']) {
    const baseDir = join(root, base);
    if (!existsSync(baseDir)) continue;
    for (const pkg of readdirSync(baseDir)) {
      const dir = join(baseDir, pkg, 'supabase', kind);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
        if (!NAME[kind].test(file))
          problems.push(`${base}/${pkg}/supabase/${kind}/${file}: bad name`);
        if (wanted.has(file)) problems.push(`${kind}/${file} is defined by two packages`);
        wanted.set(file, readFileSync(join(dir, file), 'utf8'));
      }
    }
  }

  const target = join(root, 'supabase', kind);
  if (!existsSync(target)) mkdirSync(target, { recursive: true });
  const existing = readdirSync(target).filter((f) => f.endsWith('.sql'));

  for (const [file, content] of wanted) {
    const path = join(target, file);
    const current = existsSync(path) ? readFileSync(path, 'utf8') : null;
    if (current === content) continue;
    if (check)
      problems.push(`supabase/${kind}/${file} is ${current === null ? 'missing' : 'stale'}`);
    else writeFileSync(path, content);
  }
  for (const file of existing) {
    if (wanted.has(file)) continue;
    if (check) problems.push(`supabase/${kind}/${file} has no source package`);
    else unlinkSync(join(target, file));
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  if (check) console.error("\nRun 'pnpm db:sync' and commit the result.");
  process.exit(1);
}
console.log(check ? 'SQL copies are up to date.' : 'SQL synced.');
