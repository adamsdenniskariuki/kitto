#!/usr/bin/env node
// Generate packages/core/src/database.types.ts from the local Supabase database.
//   node scripts/gen-types.mjs           write the file
//   node scripts/gen-types.mjs --check   fail if the committed file is stale (CI)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as prettier from 'prettier';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'packages/core/src/database.types.ts');
const check = process.argv.includes('--check');

const raw = execFileSync(
  'pnpm',
  ['exec', 'supabase', 'gen', 'types', 'typescript', '--local', '--schema', 'public'],
  {
    cwd: root,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'inherit'],
  },
);
const options = (await prettier.resolveConfig(target)) ?? {};
const generated = await prettier.format(raw, { ...options, filepath: target });

if (check) {
  const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== generated) {
    console.error('database.types.ts is stale. Run `pnpm db:types` and commit the result.');
    process.exit(1);
  }
  console.log('Database types are up to date.');
} else {
  writeFileSync(target, generated);
  console.log(`Wrote ${path.relative(root, target)}`);
}
