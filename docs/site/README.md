# A2UI Website & Documentation (`docs/site`)

This directory houses the next-generation **a2ui.org** website and documentation portal, built with **[Astro](https://astro.build/) + [Starlight](https://starlight.astro.build/)**.

It is designed to replace the legacy MkDocs Material site (`docs/public/` and `mkdocs.yaml`) while preserving:

- The existing GitHub Pages deployment model (`gh-pages` branch serving `https://a2ui.org`)
- All canonical JSON Schema `$id` URLs published under `https://a2ui.org/specification/...`
- Single-source-of-truth Markdown authoring (zero duplication between `specification/` and `docs/`)
- Existing documentation URL paths so bookmarks and external links continue to resolve

---

## 1. Architecture & Technology Stack

| Layer                       | Technology                                                    | Purpose                                                                                                                                                                                                           |
| :-------------------------- | :------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core Framework**          | **Astro 5** (`astro`)                                         | Static site generation (SSG), file-based routing for custom marketing pages, and Islands Architecture for interactive UI demos.                                                                                   |
| **Documentation Engine**    | **Starlight** (`@astrojs/starlight`)                          | Sidebar navigation, table of contents, dark/light theme synchronization, i18n-ready docs layout, and **Pagefind** full-text static search.                                                                        |
| **Styling & Design System** | **Tailwind CSS v4** (`@tailwindcss/vite`) + Custom CSS Tokens | High-contrast, modern developer-tool aesthetic for the bespoke landing page (`src/pages/index.astro`) and unified typography/color tokens across Starlight docs.                                                  |
| **Interactive Visual Aids** | **Astro Components & Client Scripts**                         | Interactive hero surface, Generative UI Spectrum explorer, Real Use Cases logo & screenshot tabs, Express vs. JSON compiler comparison, `@macro` expansion explorer, and Multi-Platform Native Renderer switcher. |
| **Code Highlighting**       | **Expressive Code** (built into Starlight)                    | Terminal/editor frames, file tabs, diff markers, copy buttons, and syntax highlighting for **A2UI Express** (`.a2ui`), Python, TypeScript, Swift, Kotlin, and Dart.                                               |
| **Diagrams & Alerts**       | `remark-github-blockquote-alert` & Remark Include Plugin      | Native rendering of GitHub `> [!NOTE]` alerts and zero-duplication `--8<-- "specification/..."` file inclusions.                                                                                                  |

---

## 2. Landing Page Outline (`src/pages/index.astro`)

The landing page is a standalone Astro route (`/`) structured into two major narrative halves:

### Part I: The Problem, The Spectrum & Real-World Adoption

1. **Hero: Give your agents UI on every surface**
    - Headline & value proposition: Chat is a great input, but walls of prose are a terrible output. Give your agents stateful, native UI across mobile, desktop, and web.
    - Interactive visual aid contrasting a wall of LLM text against an interactive, stateful A2UI surface bound to `dataModel` at 60fps.
2. **The Generative UI Spectrum** _(informed by the [Generative UI Spectrum taxonomy](https://www.copilotkit.ai/generative-ui-spectrum))_
    - Explains why no single Generative UI approach fits every screen—and how **one A2UI environment** spans the entire spectrum from **Fully Controlled** (developer-built deterministic SDUI & fixed schemas) → **Controlled / Server Macros** (predictable domain components chosen by the agent) → **Declarative Generative UI** (agent composes Lego-like catalog primitives on demand for the long tail) → **Open-Ended & MCP Apps** (embedded `ui://` MCP App sandboxes and bespoke surfaces).
    - Interactive spectrum slider/selector showing the developer-control vs. agent-autonomy trade-off, best-fit use cases, and code for each band.
3. **Real Use Cases in Production**
    - **Logo Bar**: **JetBrains**, **Alation**, **ByteDance**, **Google Home**, **Gemini Notebook** (plus Google Opal & Flutter GenUI).
    - **Interactive Use-Case Tabs with Visual Previews/Screenshots**:
        - Switchable tabs for **Google Home**, **Gemini Notebook**, **JetBrains**, **Alation**, and **ByteDance**, showcasing a rich visual surface preview/screenshot, how each product uses A2UI along the spectrum, and architectural highlights.

### Part II: Why A2UI? (Core Technical Differentiators)

4. **Express: ~3x faster inference compared to JSON**
    - Decoupled inference format vs. universal wire JSON (`10_notification-permission.a2ui` at 397 chars vs. 1,780 chars raw JSON, −77% characters / ~3x faster generation).
    - Side-by-side code comparison, compiler pipeline diagram, and output token benchmark chart.
5. **Macros: Give the model bigger words**
    - Hybrid SDUI + GenUI workflow where server-defined `@macro` treatments (`FlightCard`) let the LLM output a single high-level call that expands on the server into 14 primitive nodes on the wire—shipping new UIs without App Store updates.
6. **Native Rendering across Mobile, Desktop, and Web**
    - Interactive 6-platform renderer switcher (**SwiftUI**, **Jetpack Compose**, **Flutter**, **React**, **Angular**, **Lit Web Components**) showing native host widgets alongside the corresponding SDK code and ecosystem transports (**AG-UI**, **A2A**, **MCP Apps**, **CopilotKit**).

---

## 3. Markdown Authoring & Single-Source-of-Truth Specifications

### 3.1 Avoiding Duplication Between `specification/` and `docs/`

Protocol specifications live in the top-level [`specification/`](../../specification/) directory (`v0_8`, `v0_9`, `v0_9_1`, `v1_0`).
To include every specification version on `a2ui.org` **without duplicating Markdown files**:

1. Wrapper files in `src/content/docs/specification/` (e.g., `v1.0-a2ui.md`) contain YAML frontmatter and an include directive:
    ```markdown
    ---
    title: A2UI Protocol v1.0 (Candidate)
    ---
    --8<-- "specification/v1_0/docs/a2ui_protocol.md"
    ```
2. During the Astro build, `src/plugins/remark-a2ui-includes.mjs` expands `--8<-- "<path>"` directly from `<repo_root>/<path>` and rewrites relative inter-spec links (`./a2ui_extension_specification.md`, `../json/*.json`) alongside [`docs/scripts/convert_docs.py`](../scripts/convert_docs.py).

---

## 4. Preserving Canonical Schema URLs & Deployment to `a2ui.org`

1. **Canonical JSON Schema `$id` Hosting (`scripts/prepare-spec-assets.mjs`)**:
    - Copies `specification/*` and `catalogs/{basic,mcp}/v1/*` into `docs/site/public/specification/` and flattens `<version>/json/*.json` to `<version>/*.json` before `astro build` runs, ensuring all `https://a2ui.org/specification/...` schema `$id` URLs resolve identically.
2. **GitHub Pages Deployment (`.github/workflows/docs.yml`)**:
    - Builds `docs/site/dist/` (including `CNAME` for `a2ui.org` and `.nojekyll`) and deploys to the `gh-pages` branch on `a2ui-project/a2ui`.

---

## 5. Phased Implementation Plan

1. **Phase 1 — Scaffold Astro + Starlight + Tailwind v4 in `docs/site/`**
    - Initialize `docs/site/package.json`, `astro.config.mjs`, `tsconfig.json`, `src/content.config.ts`, `scripts/prepare-spec-assets.mjs`, and `src/plugins/remark-a2ui-includes.mjs`.
2. **Phase 2 — Build the Landing Page (`src/pages/index.astro`)**
    - Implement the landing page following the Part I & Part II outline (_Give your agents UI on every surface_, _The Generative UI Spectrum_, _Real Use Cases_ with JetBrains/Alation/ByteDance/Google Home/Gemini Notebook logos & screenshot tabs, and _Why A2UI_: Express, Macros, Native Rendering).
    - Visually inspect every section in Light and Dark modes using Playwright screenshots.
3. **Phase 3 — Pilot Markdown Pages Verification (2 Pilot Pages)**
    - Add **two representative pilot Markdown pages** before migrating the rest of `docs/public/`:
        1. **`src/content/docs/quickstart.md`**: Tests standard Starlight Markdown rendering, callout alerts (`> [!NOTE]`), step lists, and syntax-highlighted code blocks.
        2. **`src/content/docs/specification/v1.0-a2ui.md`**: Tests zero-duplication `--8<-- "specification/v1_0/docs/a2ui_protocol.md"` inclusion, relative link rewriting, tables, and JSON schema links.
    - Screenshot and review both pilot pages in Light and Dark mode to refine Starlight typography and theme overrides.
4. **Phase 4 — Full Documentation Migration (`src/content/docs/`)**
    - Migrate the remaining Markdown pages from `docs/public/` once the pilot pages are signed off.
5. **Phase 5 — Cutover `.github/workflows/docs.yml` & Retire MkDocs**
    - Point `.github/workflows/docs.yml` to build and deploy `docs/site/dist/`.
