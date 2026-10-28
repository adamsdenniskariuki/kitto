import { posix } from 'node:path';

export const REPO_URL = 'https://github.com/adamsdenniskariuki/kitto';
export const REPO_BRANCH = 'main';

export type PathKind = 'file' | 'dir' | null;

export interface LinkContext {
  /** Repo-relative path of the Markdown file the link is in, e.g. `docs/SETUP.md`. */
  from: string;
  /** Repo-relative path of each rendered doc → its site route, e.g. `docs/SETUP.md` → `/docs/setup/`. */
  routes: ReadonlyMap<string, string>;
  /** Heading ids of each rendered doc, keyed by repo-relative path. */
  anchors: ReadonlyMap<string, ReadonlySet<string>>;
  /** Whether a repo-relative path is a file, a directory or missing. */
  kind: (repoPath: string) => PathKind;
}

export class BrokenLinkError extends Error {
  constructor(
    readonly href: string,
    readonly from: string,
    reason: string,
  ) {
    super(`${from}: broken link "${href}" (${reason})`);
    this.name = 'BrokenLinkError';
  }
}

const SCHEME = /^[a-z][a-z\d+.-]*:/i;

/** Turn a link written for GitHub into one that works on the site, or throw if it points nowhere. */
export function rewriteHref(href: string, ctx: LinkContext): string {
  if (SCHEME.test(href) || href.startsWith('//')) return href;

  const hashAt = href.indexOf('#');
  const path = hashAt === -1 ? href : href.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : href.slice(hashAt + 1);
  const anchor = safeDecode(hash);

  if (path === '') {
    if (!ctx.anchors.get(ctx.from)?.has(anchor)) {
      throw new BrokenLinkError(href, ctx.from, `no heading #${anchor} in this page`);
    }
    return `#${hash}`;
  }

  const target = resolveRepoPath(ctx.from, safeDecode(path));
  if (target === null) throw new BrokenLinkError(href, ctx.from, 'points outside the repository');

  const route = ctx.routes.get(target);
  if (route !== undefined) {
    if (hash && !ctx.anchors.get(target)?.has(anchor)) {
      throw new BrokenLinkError(href, ctx.from, `no heading #${anchor} in ${target}`);
    }
    return hash ? `${route}#${hash}` : route;
  }

  const kind = ctx.kind(target);
  if (kind === null) throw new BrokenLinkError(href, ctx.from, `${target} does not exist`);
  const url = githubUrl(target, kind);
  return hash ? `${url}#${hash}` : url;
}

/** Resolve `href` (relative to the file `from`, or to the repo root if it starts with `/`). */
export function resolveRepoPath(from: string, href: string): string | null {
  const joined = href.startsWith('/') ? href.slice(1) : posix.join(posix.dirname(from), href);
  const normalized = posix.normalize(joined).replace(/\/+$/, '');
  if (normalized === '.' || normalized === '') return '';
  if (normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
}

export function githubUrl(repoPath: string, kind: 'file' | 'dir'): string {
  if (repoPath === '') return REPO_URL;
  const encoded = repoPath.split('/').map(encodeURIComponent).join('/');
  return `${REPO_URL}/${kind === 'dir' ? 'tree' : 'blob'}/${REPO_BRANCH}/${encoded}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
