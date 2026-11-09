# Custom Astro components and special pages

Apply these rules—alongside the universal standards in [`../SKILL.md`](../SKILL.md)—when authoring or editing Astro components (`docs/site/src/components/`), site styles (`docs/site/src/styles/`), or special non-tutorial pages such as the landing page (`index.mdx`), `ecosystem/`, `showcase`, `roadmap`, and `get-help`.

---

## Astro component styling and layout hygiene

- **Never use `<style is:inline>`**: `<style is:inline>` disables Astro's component CSS scoping and leaks rules into the global document, causing regressions across unrelated Starlight pages. Always use standard scoped `<style>` blocks.
- **Use CSS container queries instead of viewport media queries**: Components rendered inside documentation pages live next to collapsible sidebars of varying widths. Declare `container-type: inline-size` on the outer wrapper and use `@container (min-width: ...)` rules rather than `@media (min-width: ...)` so cards reflow cleanly inside narrow content columns.
- **Use design system tokens (`src/styles/tokens.css`)**:
  - Never hardcode font families or ad-hoc hex palettes; use `var(--font-body)`, `var(--font-heading)`, `var(--a2-surface)`, `var(--a2-border)`, `--text-muted-ds`, and `--text-subtle` alongside Starlight variables (`--sl-color-*`).
  - Provide explicit light-mode overrides under `:root[data-theme='light']` and verify contrast in both dark and light themes.
- **Wrap documentation diagrams in `DiagramCard`**: Any visual architecture or structural component embedded in documentation pages must wrap its markup in `<DiagramCard title="..." mermaid={mermaidSpec}>` (`src/components/docs/common/DiagramCard.astro`) so `llms-full.txt` and assistive technologies receive a clean structural representation.
- **Visual viewport verification**: Inspect rendered components in a browser (or via captured screenshots) across mobile (`375px`), tablet, and desktop widths to confirm labels do not overflow containers, badges do not overlap, and interactive controls remain accessible.

---

## Client-side script safety and interactivity

Interactive widgets (theme switchers, sliders like `GenUiSpectrum`, copy-prompt buttons like `AgentPrompt`, hero animations, media lightboxes) must handle restricted environments and synthetic test events safely:

- **Guard `localStorage` and `sessionStorage` with `try...catch`**: Direct storage reads/writes throw a `SecurityError` inside sandboxed iframes and strict privacy modes. When persisting theme changes, synchronize both `a2ui-theme` and `starlight-theme` keys inside a `try...catch` block.
- **Guard pointer capture with `if (e.isTrusted)`**: Before calling `el.setPointerCapture(e.pointerId)` or `el.releasePointerCapture(e.pointerId)` in drag/scrub handlers, check `if (e.isTrusted)` so synthetic `PointerEvent`s dispatched in automated browser tests do not throw `NotFoundError`.
- **Copy-button hygiene**:
  - Keep single-line copyable shell commands on a **single line** in the `.astro` template; multi-line source indentation inside inline `<code>` tags can be captured as extra whitespace when users copy text.
  - Store and `clearTimeout` any active label-reset timer before starting a new one so rapid clicks do not reset the `"Copied!"` state prematurely.
- **Dialog and media lightbox cleanup**: When closing a `<dialog>` or media modal, clear `src` attributes on `<video>` / `<img>` elements to prevent a flash of stale media on reopen, and restore keyboard focus to the trigger element (`lastTrigger?.focus()`).
- **Base-path and OS portability in component code**:
  - Never hardcode root `/path/` URLs inside `.astro` anchor or asset attributes; use relative URLs or prefix routes with `import.meta.env.BASE_URL` so components pass `ASTRO_BASE` containment checks under `/preview/` and `/pr-preview/pr-<N>/`.
  - Fall back to `'https://a2ui.org'` when reading `import.meta.env.SITE` so generated URLs remain valid in local dev builds.
  - Use `\r?\n` rather than `\n` when splitting template or file strings in component/build scripts so Windows CRLF checkouts do not break builds.
- **Clean MDX extraction**: Ensure custom components imported into `.mdx` pages do not leak raw JSX fragments when `scripts/emit-markdown-bundle.mjs` generates `llms-full.txt`.
- **Automated tests**: When adding nontrivial interactive logic, URL helpers, or build utilities, add unit tests under `docs/site/tests/` (executed via `npm --prefix docs/site test`).

---

## Special pages (Ecosystem, Showcase, Roadmap, Get Help)

- **Direct opening sentences on directory pages**: Even on curated directories (`ecosystem/renderers.mdx`, `showcase`, `get-help`), avoid meta-openings like _"This page lists..."_. State what the ecosystem or resource collection provides directly (for example, _"Community renderers, agent libraries, and developer tools extend A2UI across additional UI frameworks and runtimes."_).
- **Interactive lifecycle and comparison visuals**: Pages like the Roadmap (`RoadmapLoop.astro`) and Generative UI Spectrum (`GenUiSpectrum.astro`) pair interactive visual components with clear prose descriptions of each stage or category so readers and coding agents alike can read the full content sequentially.
- **Verified external links and package claims**: Confirm external repository links, consultant/brand assets, and `npx` / package install commands are live and published before listing them on public showcase or help pages.
