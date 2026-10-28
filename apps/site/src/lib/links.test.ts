import { describe, expect, it } from 'vitest';
import { BrokenLinkError, resolveRepoPath, rewriteHref, type LinkContext } from './links';

const files = new Set(['README.md', 'apps/demo/README.md', '.env.example', 'docs/SETUP.md']);
const dirs = new Set(['packages', 'packages/core', 'tools/create-kitto-module']);

const ctx = (from: string): LinkContext => ({
  from,
  routes: new Map([
    ['README.md', '/docs/overview/'],
    ['docs/SETUP.md', '/docs/setup/'],
    ['LEARNING.md', '/docs/learning/'],
  ]),
  anchors: new Map([
    ['README.md', new Set(['quick-start'])],
    ['docs/SETUP.md', new Set(['1-local-development', 'tests'])],
    ['LEARNING.md', new Set(['9-gapless-invoice-numbers'])],
  ]),
  kind: (p) => (files.has(p) ? 'file' : dirs.has(p) ? 'dir' : null),
});

describe('resolveRepoPath', () => {
  it('resolves relative to the linking file', () => {
    expect(resolveRepoPath('docs/SETUP.md', '../LEARNING.md')).toBe('LEARNING.md');
    expect(resolveRepoPath('docs/SETUP.md', './TUTORIAL.md')).toBe('docs/TUTORIAL.md');
    expect(resolveRepoPath('README.md', 'packages/core/')).toBe('packages/core');
    expect(resolveRepoPath('docs/SETUP.md', '/README.md')).toBe('README.md');
  });

  it('refuses paths outside the repository', () => {
    expect(resolveRepoPath('README.md', '../outside.md')).toBeNull();
  });
});

describe('rewriteHref', () => {
  it('maps links between rendered docs to site routes, keeping anchors', () => {
    expect(rewriteHref('docs/SETUP.md', ctx('README.md'))).toBe('/docs/setup/');
    expect(rewriteHref('../LEARNING.md', ctx('docs/SETUP.md'))).toBe('/docs/learning/');
    expect(rewriteHref('./SETUP.md#tests', ctx('docs/TUTORIAL.md'))).toBe('/docs/setup/#tests');
    expect(rewriteHref('#quick-start', ctx('README.md'))).toBe('#quick-start');
  });

  it('points other repo files and folders at GitHub', () => {
    expect(rewriteHref('../apps/demo/README.md#sample-data', ctx('docs/SETUP.md'))).toBe(
      'https://github.com/adamsdenniskariuki/kitto/blob/main/apps/demo/README.md#sample-data',
    );
    expect(rewriteHref('../.env.example', ctx('docs/SETUP.md'))).toBe(
      'https://github.com/adamsdenniskariuki/kitto/blob/main/.env.example',
    );
    expect(rewriteHref('packages/core/', ctx('README.md'))).toBe(
      'https://github.com/adamsdenniskariuki/kitto/tree/main/packages/core',
    );
  });

  it('leaves external links alone', () => {
    for (const href of ['https://supabase.com', 'mailto:a@b.c', '//example.com/x']) {
      expect(rewriteHref(href, ctx('README.md'))).toBe(href);
    }
  });

  it('throws on missing files and unknown anchors', () => {
    expect(() => rewriteHref('docs/MISSING.md', ctx('README.md'))).toThrow(BrokenLinkError);
    expect(() => rewriteHref('docs/SETUP.md#nope', ctx('README.md'))).toThrow(/no heading #nope/);
    expect(() => rewriteHref('#nope', ctx('README.md'))).toThrow(BrokenLinkError);
    expect(() => rewriteHref('../../x.md', ctx('docs/SETUP.md'))).toThrow(/outside/);
  });
});
