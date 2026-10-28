// @ts-check
import { defineConfig } from 'astro/config';

// Static site served from the root of kitto.madebyfavor.com (GitHub Pages, see public/CNAME).
export default defineConfig({
  site: 'https://kitto.madebyfavor.com',
  base: '/',
  output: 'static',
  trailingSlash: 'ignore',
  build: { format: 'directory' },
  devToolbar: { enabled: false },
  server: { port: 4321, host: '127.0.0.1' },
  // Mermaid's diagram renderers are large but are only loaded on demand by doc pages with diagrams.
  vite: { build: { chunkSizeWarningLimit: 2000 } },
});
