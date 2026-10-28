import type { MermaidConfig } from 'mermaid';

/**
 * Renders the ```mermaid blocks that src/lib/docs.ts leaves in the page, and
 * re-renders them in the matching theme when the colour scheme changes. If a
 * diagram fails to render, its source stays visible as the text fallback.
 */
async function main() {
  const blocks = [...document.querySelectorAll<HTMLElement>('.mermaid[data-source]')];
  if (blocks.length === 0) return;

  const { default: mermaid } = await import('mermaid');
  let generation = 0;

  async function render() {
    const current = ++generation;
    const dark = document.documentElement.dataset.theme === 'dark';
    const config: MermaidConfig = {
      startOnLoad: false,
      securityLevel: 'strict',
      theme: dark ? 'dark' : 'default',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      // The dark theme's default edge-label background is too low-contrast for WCAG AA.
      themeVariables: dark ? { edgeLabelBackground: '#1b1d26' } : {},
    };
    mermaid.initialize(config);
    for (const [index, block] of blocks.entries()) {
      try {
        const { svg } = await mermaid.render(
          `diagram-${index}-${current}`,
          block.dataset.source ?? '',
        );
        if (current !== generation) return;
        block.innerHTML = svg;
        block.setAttribute('role', 'img');
        block.setAttribute('aria-label', block.dataset.label ?? 'Diagram');
        block.dataset.rendered = dark ? 'dark' : 'light';
      } catch (error) {
        if (current !== generation) return;
        block.dataset.rendered = 'error';
        console.warn(`Diagram ${index} could not be rendered`, error);
      }
    }
  }

  await render();
  document.addEventListener('kitto:theme', () => void render());
}

void main();
