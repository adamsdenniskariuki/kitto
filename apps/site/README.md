# @kitto/site

The static docs and landing site for Kitto, published to GitHub Pages at
**[kitto.madebyfavor.com](https://kitto.madebyfavor.com)**. It is plain
[Astro](https://astro.build) with no server: every page is HTML built ahead of
time. The Next.js demo (`apps/demo`) can't run on Pages, so the site has
screenshots of it instead and says "Live demo: coming soon".

## Commands

Run these from the repo root with `pnpm --filter @kitto/site <script>`, or from
this folder with `pnpm <script>`.

| Script        | What it does                                                                     |
| ------------- | -------------------------------------------------------------------------------- |
| `dev`         | Dev server at <http://127.0.0.1:4321>.                                           |
| `build`       | Static build into `dist/` (fails on broken doc links).                           |
| `preview`     | Serves the built `dist/`.                                                        |
| `typecheck`   | `astro check` (TypeScript and `.astro` files).                                   |
| `test`        | Vitest unit tests for the Markdown pipeline and link rewriting.                  |
| `test:e2e`    | Playwright smoke and axe tests against `astro preview`. Run `build` first.       |
| `screenshots` | Recaptures the demo screenshots in `public/screenshots/` (see below; not in CI). |

Root `pnpm build`, `pnpm typecheck` and `pnpm test` include the site through
Turborepo. The Playwright suites only run through `test:e2e`, as in `apps/demo`.
Run `pnpm --filter @kitto/site exec playwright install chromium` once before the
first `test:e2e`.

## How the docs are built

The docs pages are rendered at build time from the repo's own Markdown, so there
is one copy of each:

| Route                 | Source                 |
| --------------------- | ---------------------- |
| `/docs/overview/`     | `README.md`            |
| `/docs/setup/`        | `docs/SETUP.md`        |
| `/docs/tutorial/`     | `docs/TUTORIAL.md`     |
| `/docs/architecture/` | `docs/ARCHITECTURE.md` |
| `/docs/learning/`     | `LEARNING.md`          |

The list lives in `src/lib/docs.ts` (`DOCS`). The pipeline is remark (GFM) →
rehype → Shiki (light and dark themes). Headings get GitHub-style ids, so
anchors from GitHub keep working.

Links are rewritten in `src/lib/links.ts`:

- **Links between those five files** (`docs/SETUP.md`, `../LEARNING.md`,
  `./TUTORIAL.md#anchor`) become site routes such as `/docs/tutorial/#anchor`.
- **Links to any other repo path** (`packages/booking/src/…`, `supabase/`) go
  to GitHub: `https://github.com/adamsdenniskariuki/kitto/blob/main/<path>` for
  files and `/tree/main/<path>` for folders.
- **External links** are left alone.

The build fails, listing every problem, when any of these is broken:

- a link to a missing file;
- a link that points outside the repo;
- an anchor with no matching heading;
- a missing image.

The Playwright smoke test also crawls every internal link and anchor in `dist/`.

### Mermaid

` ```mermaid ` fences become `<figure>`s holding the diagram source. Each one has
an accessible name taken from the nearest heading, and the source is shown as a
fallback. `src/scripts/mermaid.ts` loads Mermaid only on pages that have diagrams.
It renders them with a theme that matches light or dark mode, and re-renders
when the theme is toggled. If one diagram fails to parse, the rest still render
and that one keeps its source.

Mermaid treats `;` as the end of a statement, so `prepareMermaid()` escapes
semicolons inside sequence-diagram messages as `#59;`. This changes only the
copy given to Mermaid. The Markdown files are untouched.

## Brand

The logo (`src/components/Logo.astro`, `public/favicon.svg`) uses the stacked
building-blocks style of [madebyfavor.com](https://madebyfavor.com), redrawn as
Kitto's own SVG; none of their assets are linked. The colours are CSS custom
properties in `src/styles/global.css`, checked for WCAG AA contrast in both
themes. The theme follows `prefers-color-scheme` until a visitor picks one. The
choice is saved in `localStorage` (`kitto-theme`) and applied before the first
paint, so the page doesn't flash.

## Demo screenshots

The gallery on the landing page shows the PNGs in `public/screenshots/`. Only
files that exist are shown; the titles and alt text are in `src/lib/content.ts`.
`screenshots/demo.spec.ts` captures them from the real demo app:

1. It signs in through Mailpit.
2. It creates a workspace ("Savannah Lodge").
3. It clicks **Load sample data**.
4. It saves seven pages at 1280×800: home, admin roles, bookings, an invoice,
   orders, inventory and reports.
5. It shrinks each one with `sharp` to a palette PNG.

To regenerate them (Docker must be running):

```sh
# From the repo root
pnpm exec supabase start -x studio,imgproxy,edge-runtime,logflare,vector,supavisor
# apps/demo/.env.local must point at the local stack (see docs/SETUP.md)
pnpm --filter @kitto/demo build
pnpm --filter @kitto/site screenshots
```

`playwright.screenshots.config.ts` starts the demo with
`pnpm --filter @kitto/demo start` on port 3000, or reuses one that is already
running. Check the new images by eye before you commit them.

## Deploy

`.github/workflows/pages.yml` runs `build-test` on pull requests and pushes to
`main` that touch the site, the docs, `README.md`, `LEARNING.md` or the
lockfile. It builds the site and runs `test:e2e`.

On pushes to `main`, and on manual runs, a `deploy` job then publishes
`apps/site/dist` with `actions/deploy-pages`. `public/CNAME` puts
`kitto.madebyfavor.com` into the build. The repository's Pages source must be
set to **GitHub Actions**. The domain needs a DNS `CNAME` record pointing at
`<owner>.github.io`.
