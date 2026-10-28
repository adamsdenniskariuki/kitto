import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import rehypeShiki, { type RehypeShikiOptions } from '@shikijs/rehype';
import GithubSlugger from 'github-slugger';
import type { Element, ElementContent, Root as HastRoot } from 'hast';
import { toString as hastToString } from 'hast-util-to-string';
import type { Heading, Root as MdastRoot } from 'mdast';
import { toString as mdastToString } from 'mdast-util-to-string';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import {
  BrokenLinkError,
  githubUrl,
  resolveRepoPath,
  rewriteHref,
  type LinkContext,
} from './links';

export interface DocMeta {
  slug: string;
  /** Repo-relative Markdown file, the single source of truth for the page. */
  source: string;
  navTitle: string;
  description: string;
}

/** The repo's Markdown docs rendered on the site, in navigation order. */
export const DOCS: readonly DocMeta[] = [
  {
    slug: 'overview',
    source: 'README.md',
    navTitle: 'Overview',
    description: 'What Kitto is, its modules, the quick start and the module generator.',
  },
  {
    slug: 'setup',
    source: 'docs/SETUP.md',
    navTitle: 'Setup',
    description: 'Local development, Supabase, Vercel, M-Pesa (Daraja) and environment variables.',
  },
  {
    slug: 'tutorial',
    source: 'docs/TUTORIAL.md',
    navTitle: 'Tutorial',
    description: 'Build "Kitto Garage", a small dealership and workshop, in an hour.',
  },
  {
    slug: 'architecture',
    source: 'docs/ARCHITECTURE.md',
    navTitle: 'Architecture',
    description: 'System and request diagrams, data model, tenancy, roles and every module.',
  },
  {
    slug: 'learning',
    source: 'LEARNING.md',
    navTitle: 'Learning',
    description: 'The notable SQL and TypeScript techniques Kitto uses, with real snippets.',
  },
];

export const docRoute = (slug: string) => `/docs/${slug}/`;

export interface DocHeading {
  depth: number;
  text: string;
  id: string;
}

export interface RenderedDoc extends DocMeta {
  route: string;
  title: string;
  html: string;
  headings: DocHeading[];
  diagrams: number;
}

/** Walk up from the working directory to the monorepo root (the folder with pnpm-workspace.yaml). */
export function findRepoRoot(start = process.env.KITTO_REPO_ROOT ?? process.cwd()): string {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    if (dirname(dir) === dir) throw new Error(`No pnpm-workspace.yaml above ${start}`);
  }
}

function headingSlugs(tree: MdastRoot): DocHeading[] {
  const slugger = new GithubSlugger();
  const headings: DocHeading[] = [];
  visit(tree, 'heading', (node: Heading) => {
    const text = mdastToString(node);
    headings.push({ depth: node.depth, text, id: slugger.slug(text) });
  });
  return headings;
}

const parser = unified().use(remarkParse).use(remarkGfm);

/** Remark: give headings GitHub-style ids, drop the H1 (the layout renders it), rewrite links. */
function remarkKitto(options: {
  headings: DocHeading[];
  links: Omit<LinkContext, 'from'>;
  from: string;
  errors: BrokenLinkError[];
}) {
  return (tree: MdastRoot) => {
    let index = 0;
    visit(tree, 'heading', (node: Heading) => {
      const heading = options.headings[index++];
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: heading?.id } };
    });
    const h1 = tree.children.findIndex((n) => n.type === 'heading' && n.depth === 1);
    if (h1 !== -1) tree.children.splice(h1, 1);

    const ctx: LinkContext = { ...options.links, from: options.from };
    visit(tree, (node) => {
      if (node.type !== 'link' && node.type !== 'definition' && node.type !== 'image') return;
      try {
        node.url = node.type === 'image' ? rewriteImage(node.url, ctx) : rewriteHref(node.url, ctx);
      } catch (error) {
        if (error instanceof BrokenLinkError) options.errors.push(error);
        else throw error;
      }
    });
  };
}

function rewriteImage(src: string, ctx: LinkContext): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(src) || src.startsWith('//')) return src;
  const target = resolveRepoPath(ctx.from, src.split('#')[0] ?? '');
  if (target === null || ctx.kind(target) !== 'file') {
    throw new BrokenLinkError(src, ctx.from, 'image does not exist');
  }
  return githubUrl(target, 'file').replace('/blob/', '/raw/');
}

const isElement = (node: unknown, tag?: string): node is Element =>
  typeof node === 'object' &&
  node !== null &&
  (node as Element).type === 'element' &&
  (tag === undefined || (node as Element).tagName === tag);

const text = (value: string) => ({ type: 'text' as const, value });
const el = (
  tagName: string,
  properties: Element['properties'],
  children: ElementContent[] = [],
): Element => ({ type: 'element', tagName, properties, children });

/**
 * Mermaid ends a statement at `;`, so a semicolon inside a sequence diagram
 * message or note breaks parsing. Escape it as the `#59;` entity, which
 * Mermaid draws as a semicolon.
 */
export function prepareMermaid(source: string): string {
  if (!/^\s*sequenceDiagram\b/.test(source)) return source;
  return source
    .split('\n')
    .map((line) => {
      const colon = line.indexOf(':');
      return colon === -1
        ? line
        : line.slice(0, colon + 1) + line.slice(colon + 1).replaceAll(';', '#59;');
    })
    .join('\n');
}

/**
 * Rehype: turn ```mermaid fences into figures that the browser renders (see
 * src/scripts/mermaid.ts). The source stays in the page as a text fallback.
 */
function rehypeMermaid(options: { count: (n: number) => void }) {
  return (tree: HastRoot) => {
    let lastHeading = '';
    let count = 0;
    const labels = new Map<string, number>();
    visit(tree, 'element', (node, index, parent) => {
      if (/^h[1-6]$/.test(node.tagName)) {
        lastHeading = hastToString(node);
        return;
      }
      const code = node.children[0];
      if (node.tagName !== 'pre' || !isElement(code, 'code')) return;
      const classes = code.properties.className;
      if (!Array.isArray(classes) || !classes.includes('language-mermaid')) return;
      if (!parent || index === undefined) return;

      const source = hastToString(code).trimEnd();
      const base = lastHeading ? `Diagram: ${lastHeading}` : 'Diagram';
      const seen = (labels.get(base) ?? 0) + 1;
      labels.set(base, seen);
      const label = seen > 1 ? `${base} (${seen})` : base;
      count++;
      parent.children[index] = el('figure', { className: ['diagram'] }, [
        el(
          'div',
          { className: ['mermaid'], dataSource: prepareMermaid(source), dataLabel: label },
          [el('pre', { className: ['mermaid-fallback'], tabIndex: 0 }, [text(source)])],
        ),
        el('figcaption', {}, [
          el('details', { className: ['diagram-source'] }, [
            el('summary', {}, [text(`${label} (Mermaid source)`)]),
            el('pre', { tabIndex: 0 }, [el('code', {}, [text(source)])]),
          ]),
        ]),
      ]);
      return 'skip';
    });
    options.count(count);
  };
}

/** Rehype: scrollable tables, and headings that link to themselves. */
function rehypeEnhance() {
  return (tree: HastRoot) => {
    let lastHeading = '';
    visit(tree, 'element', (node, index, parent) => {
      if (/^h[2-6]$/.test(node.tagName) && typeof node.properties.id === 'string') {
        lastHeading = hastToString(node);
        node.children = [
          el('a', { className: ['heading-link'], href: `#${node.properties.id}` }, node.children),
        ];
        return 'skip';
      }
      if (node.tagName === 'table' && parent && index !== undefined) {
        parent.children[index] = el(
          'div',
          {
            className: ['table-wrap'],
            tabIndex: 0,
            role: 'region',
            ariaLabel: lastHeading ? `Table: ${lastHeading}` : 'Table',
          },
          [node],
        );
        return 'skip';
      }
    });
  };
}

function repoKind(root: string) {
  return (repoPath: string) => {
    const full = join(root, repoPath);
    if (!existsSync(full)) return null;
    return statSync(full).isDirectory() ? ('dir' as const) : ('file' as const);
  };
}

/** Render every doc from the repo's Markdown. Throws if any link is broken. */
const SHIKI_OPTIONS: RehypeShikiOptions = {
  themes: { light: 'github-light-default', dark: 'github-dark-default' },
  defaultColor: false,
  defaultLanguage: 'text',
  fallbackLanguage: 'text',
  langs: ['bash', 'json', 'powershell', 'sql', 'ts', 'tsx'],
};

export async function renderDocs(root = findRepoRoot()): Promise<RenderedDoc[]> {
  const sources = DOCS.map((meta) => {
    const markdown = readFileSync(join(root, meta.source), 'utf8');
    const headings = headingSlugs(parser.parse(markdown));
    return { meta, markdown, headings };
  });

  const routes = new Map(DOCS.map((d) => [d.source, docRoute(d.slug)]));
  const anchors = new Map(
    sources.map((s) => [s.meta.source, new Set(s.headings.map((h) => h.id))]),
  );
  const links = { routes, anchors, kind: repoKind(root) };
  const errors: BrokenLinkError[] = [];

  const rendered: RenderedDoc[] = [];
  for (const { meta, markdown, headings } of sources) {
    let diagrams = 0;
    const file = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkKitto, { headings, links, from: meta.source, errors })
      .use(remarkRehype)
      .use(rehypeMermaid, { count: (n: number) => (diagrams = n) })
      .use(rehypeShiki, SHIKI_OPTIONS)
      .use(rehypeEnhance)
      .use(rehypeStringify)
      .process(markdown);

    const title = headings.find((h) => h.depth === 1)?.text ?? meta.navTitle;
    rendered.push({
      ...meta,
      route: docRoute(meta.slug),
      title,
      html: String(file),
      headings: headings.filter((h) => h.depth > 1),
      diagrams,
    });
  }

  if (errors.length > 0) {
    throw new Error(
      `Broken links in the docs:\n${errors.map((e) => `  - ${e.message}`).join('\n')}`,
    );
  }
  return rendered;
}

let cache: Promise<RenderedDoc[]> | undefined;

/** Rendered docs, computed once per build. */
export function getDocs(): Promise<RenderedDoc[]> {
  cache ??= renderDocs();
  return cache;
}
