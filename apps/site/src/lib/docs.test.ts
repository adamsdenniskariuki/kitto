import { describe, expect, it } from 'vitest';
import { DOCS, prepareMermaid, renderDocs } from './docs';

describe('prepareMermaid', () => {
  it('escapes semicolons in sequence diagram messages and notes', () => {
    const source = 'sequenceDiagram\n  A->>B: one; two\n  Note over A: x; y';
    expect(prepareMermaid(source)).toBe(
      'sequenceDiagram\n  A->>B: one#59; two\n  Note over A: x#59; y',
    );
  });

  it('leaves other diagrams alone', () => {
    const source = 'flowchart LR\n  A --> B;';
    expect(prepareMermaid(source)).toBe(source);
  });
});

// Renders the real README, docs/*.md and LEARNING.md; renderDocs throws on any broken link.
describe('renderDocs', async () => {
  const docs = await renderDocs();

  it('renders every doc with a title and headings', () => {
    expect(docs.map((d) => d.source)).toEqual(DOCS.map((d) => d.source));
    for (const doc of docs) {
      expect(doc.title, doc.source).not.toBe('');
      expect(doc.headings.length, doc.source).toBeGreaterThan(0);
      expect(doc.html, doc.source).not.toContain('<h1');
    }
  });

  it('leaves no links to Markdown files in the repo', () => {
    for (const doc of docs) {
      for (const [, href] of doc.html.matchAll(/<a [^>]*href="([^"]*)"/g)) {
        if (href!.startsWith('https://github.com/')) continue;
        expect(href, doc.source).not.toMatch(/\.md(#|$)/);
      }
    }
  });

  it('turns mermaid fences into diagrams', () => {
    const overview = docs.find((d) => d.slug === 'overview')!;
    expect(overview.diagrams).toBeGreaterThan(0);
    expect(overview.html).toContain('class="mermaid"');
    expect(overview.html).not.toContain('language-mermaid');
  });

  it('gives headings GitHub-style ids', () => {
    const tutorial = docs.find((d) => d.slug === 'tutorial')!;
    expect(tutorial.html).toContain('id="000-010-get-the-demo-running"');
  });
});
