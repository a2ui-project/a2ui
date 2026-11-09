---
name: public-documentation
description: >-
  Defines authoring, multi-version tabbing, multi-SDK code example, diagram, and
  PR preview standards for the A2UI developer site (docs/site/). Progressively
  routes by page type (guides, concepts, components/landing pages, and
  specifications/agent manifests) so agents load only the rules relevant to
  their task.
metadata:
  internal: true
---

# Public documentation authoring skill

This skill defines universal authoring standards for the A2UI developer site (`docs/site/`) and routes by high-level page type so you load only the instructions needed for the content you are creating, editing, or reviewing.

---

## Progressive routing by page type

All changes to `docs/site/` must follow the **Universal standards** and **Verification and pull request reviews** sections in this file. Beyond those universal rules, identify the high-level page type or site layer in your task and read **only** the matching reference file(s) below:

| Page type / site layer                                    | Scope                                                                                                                                                                                                             | Reference file to load                                                                                                                                                                                                                        |
| :-------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Guides, tutorials, and quickstarts**                    | Procedural integration guides, step-by-step tutorials, and onboarding quickstarts (e.g. `docs/site/src/content/docs/guides/**`)                                                                                   | [`references/guides-and-quickstarts.md`](references/guides-and-quickstarts.md) — Lean 4–5 step core path, application code before wire JSON, "No Missing Glue" entry points, v1.0-focused prose, and runtime snippet lifecycle hygiene.       |
| **Conceptual pages and diagrams**                         | Architectural overviews, mental-model explanations, glossary definitions, and visual diagrams (e.g. `docs/site/src/content/docs/concepts/**`)                                                                     | [`references/concepts-and-diagrams.md`](references/concepts-and-diagrams.md) — Mental-model framing, v1.0/v0.9.1 wire comparisons, hybrid diagram pattern, Mermaid vs. `<DiagramCard>`, and glossary/schema deep-linking.                     |
| **Custom Astro components, landing, and directory pages** | Reusable `.astro` components and site styles (`docs/site/src/components/**`, `docs/site/src/styles/**`), plus marketing/landing, overview, and curated directory pages                                            | [`references/components-and-landing-pages.md`](references/components-and-landing-pages.md) — Scoped Astro styles, container queries, design tokens, defensive client scripts, and overview/directory page conventions.                        |
| **Specifications, schemas, and AI agent manifests**       | Specification include wrappers (`docs/site/src/content/docs/specification/**`), `docs/site/llms.txt`, dynamic `.md` endpoints (`docs/site/src/pages/**/*.md.ts`), and site build scripts (`docs/site/scripts/**`) | [`references/specifications-and-agent-manifests.md`](references/specifications-and-agent-manifests.md) — `--8<--` spec inclusions, version status labels, `llms.txt` placeholders, fence-aware `llms-full.txt` bundling, and `.md` endpoints. |

If you are **only** writing a conceptual page (and not adding a custom `.astro` component), read [`references/concepts-and-diagrams.md`](references/concepts-and-diagrams.md) and skip the guide, component, and manifest references. If a conceptual or guide page also introduces a new `.astro` visual component under `src/components/`, load [`references/components-and-landing-pages.md`](references/components-and-landing-pages.md) as well.

---

## Universal standards (apply to every page)

Every page across `docs/site/` must follow these style, component, tabbing, and linking rules regardless of page category.

### Tone, style, and list conventions

- **Natural writing**: Follow [`natural-writing`](../natural-writing/SKILL.md). State technical facts directly, use plain copulas ("is", "are") rather than figurative phrasing ("serves as", "stands as"), and never use promotional buzzwords or AI-isms (such as _seamlessly_, _robust_, _delve_, _empower_, _leverage_, _tapestry_).
- **First-sentence purpose statement**: Every documentation page (excluding marketing hero pages and raw `--8<--` specification wrappers) must open immediately with a natural, concise sentence explaining what the page covers so readers can tell right away whether it answers their question. Avoid meta-formulas such as "This page covers...", "This page lists...", or "In this guide, we will...".
- **Descriptive, unnumbered headings**: Never prefix headings with numbers (such as `## 1. Overview` or `### 2. Setup`) unless the numbers carry formal meaning (such as numbered specification clauses or strict protocol execution phases). For sequential tutorial steps, use Starlight `<Steps>` or unnumbered prose headings instead.
- **Never use numbered lists for unordered items**:
  - Use **unordered bullet points (`-`)** whenever items do not have an inherent chronological, procedural, or ranked sequence—including feature lists, component properties, architectural layers, design principles, configuration flags, or alternative options.
  - Reserve **numbered lists (`1.`, `2.`, `3.`)** strictly for sequential step-by-step instructions, ordered execution phases, or explicit precedence rankings.
- **Link key terms**: Link domain concepts (such as surface, catalog, data model, renderer) to their formal glossary or specification definitions on first mention.

### Starlight and MDX authoring conventions

- **Explicit component imports**: Import Starlight components at the top of `.mdx` files:
  ```typescript
  import {Aside, Badge, Steps, Tabs, TabItem} from '@astrojs/starlight/components';
  ```
- **Callouts with `<Aside>`**: In `.mdx` pages, use `<Aside type="note|tip|caution|danger" title="...">` for callouts rather than raw blockquotes or GitHub alert syntax:
  - `note`: Context, version availability notices, or background details.
  - `tip`: Practical recommendations or shortcuts.
  - `caution`: Common pitfalls, limitations, or deprecations.
  - `danger`: Breaking changes, security boundaries, or data-loss risks.
- **Escape HTML-like tags in MDX prose**: MDX compiles unquoted angle-bracket tags as JSX components and fails the build on unknown elements. Wrap literal tag names in inline backticks (for example, `` `<script>` ``, `` `<link>` ``, `` `<dialog>` ``) whenever mentioning them in prose.
- **Sequential steps and badges**: Use `<Steps>` around ordered Markdown lists for multi-step procedures (always include blank lines immediately after `<Steps>` and before `</Steps>` so MDX parses the items as a Markdown list), and `<Badge text="..." variant="..." />` for inline status indicators.

### Multi-SDK, multi-framework, and protocol version tabs

Whenever a page presents tabbed code or wire payloads, use the canonical Starlight `syncKey` values, tab labels, and ordering below so user selections persist cleanly across the site:

| Context                    | `syncKey`            | Canonical tab order and label rules                                                                                                                                                                                                                                                                                                                                                                                                        |
| :------------------------- | :------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent / Core SDKs**      | `sdk-lang`           | `TypeScript` -> `Python` -> `Dart` -> `Swift` -> `Kotlin` (omit `Swift` and `Kotlin` for Agent SDK examples, as Swift and Kotlin focus on client-side Core, client functions, and UI rendering without an Agent SDK; for Core state, client functions, and schema parity tests, include Kotlin alongside Swift; use supported subsets such as `TypeScript` -> `Python` when only a subset of language bindings exists for an integration). |
| **Client-only Core SDKs**  | `client-sdk`         | `TypeScript` -> `Dart` -> `Swift` -> `Kotlin` (omit `Python`, which is server/agent-only).                                                                                                                                                                                                                                                                                                                                                 |
| **All UI Renderers**       | `renderer-framework` | `Flutter` -> `React` -> `Lit` -> `Angular` -> `SwiftUI` -> `Jetpack Compose` (never collapse React, Lit, and Angular into a single "Web" tab, and never substitute a placeholder link for Jetpack Compose when other frameworks show code).                                                                                                                                                                                                |
| **Web-only Renderers**     | `web-framework`      | `Lit` -> `React` -> `Angular` (or `React` -> `Lit` -> `Angular`). Never reuse `renderer-framework` on a 3-tab Web block, or mobile tab selections elsewhere will leave tabs unselected.                                                                                                                                                                                                                                                    |
| **Protocol Wire Versions** | `protocol-version`   | `v1.0` -> `v0.9.1`. Always use plain version strings (`label="v1.0"`, `label="v0.9.1"`). Never append status words like `(Current)` or `(Candidate)`—Starlight matches exact label strings to sync tabs, and [`AGENTS.md`](../../../AGENTS.md#version-labels) forbids status labels in tab headers.                                                                                                                                        |
| **Build / Environment**    | `bundler`, `os`      | Use `syncKey="bundler"` (e.g. `Vite`, `Angular CLI`) and `syncKey="os"` (e.g. `macOS and Linux`, `Windows`) for tooling comparisons.                                                                                                                                                                                                                                                                                                       |

- **Expressive Code header framing**: Starlight's `@expressive-code/plugin-frames` renders an editor title bar when a code block starts with a file-path comment. Either provide clean file-path comments consistently across **every** tab in a group (e.g. `// src/App.tsx`, `// lib/main.dart`), or omit top-line comments across the entire group and start directly with imports. Never mix file paths with conversational comments like `// Inside MyService (...)`.
- **Protocol version authority**: Follow [`AGENTS.md`](../../../AGENTS.md#version-labels) whenever naming protocol versions. Never attach words like _current_, _latest_, _active_, _stable_, or _candidate_ to a version number in running prose. In JSON envelopes, use `"version": "1.0"` (no `"v"` prefix) for v1.0 and `"version": "v0.9"` (or `"v0.9.1"`) for v0.9.x.

### Internal linking and permalink standards

- **Standard Markdown relative links**: Always write internal cross-references between documentation pages as standard Markdown relative links with trailing slashes (for example, `[Concept title](../concepts/<topic>/)` or `[Guide section](../guides/<guide>/#<section>)`). Do not use raw HTML `<a>` tags with imported JS URL constants, and do not hardcode root-relative `/concepts/...` paths—relative links stay portable across local dev, `/preview/`, `/pr-preview/pr-<N>/`, and production root deployments.
- **Schema permalink exception**: Root-relative paths are reserved strictly for protocol JSON schemas and the interactive JSON Schemas Explorer:
  - Human-browsable explorer in prose: `/specification/v1_0/schemas/#<schema-file>.json/<json-pointer>`
  - Raw schema files: `/specification/v1_0/<schema-file>.json` (reserve full `https://a2ui.org/specification/...` URLs for JSON `$id` and `$ref` fields).
- **No raw GitHub blobs or unmerged routes**: Never link to `github.com/.../blob/...` or `raw.githubusercontent.com` for content hosted on the site, and never link to placeholder or unmerged pages.

---

## Verification and pull request reviews (apply to every PR)

Run this checklist before opening or updating any pull request touching `docs/site/`, `specification/`, or `catalogs/`:

1. **Verify SDK and code accuracy**: Confirm all package names, imports, class names, method signatures, and CLI commands match live implementations in the repository. For Kotlin and Jetpack Compose (`androidx.a2ui`, `androidx.a2ui.compose`, `androidx.compose.material3:material3-a2ui`), sparse-clone the AndroidX repository (`https://android.googlesource.com/platform/frameworks/support` branch `androidx-main`, paths `a2ui` and `compose/material3/material3-a2ui`) into a temporary directory outside the repository (or git-ignored scratch directory) and verify every import, signature, and sample against `api/current.txt` and source files. Consult [`a2ui-doc-sync-check`](../a2ui-doc-sync-check/SKILL.md) when SDKs and docs change together.
2. **Validate JSON examples against protocol schemas**:
   ```bash
   python3 docs/scripts/validate_doc_examples.py
   ```
3. **Build the site and run post-build link and anchor checks**:
   ```bash
   npm --prefix docs/site run build
   ```
   This compiles Astro/MDX, generates `llms-full.txt` and `.md` mirrors, verifies `--8<--` spec inclusions and schema pointers (`verify-spec-links.mjs`), and runs `check-links.mjs` to validate every internal route, `ASTRO_BASE` boundary, and `#fragment` HTML anchor. If you modified custom scripts or link logic, also run `npm --prefix docs/site test`.
4. **Audit writing style and list formatting**: Check all prose against [`natural-writing`](../natural-writing/SKILL.md) and confirm that headings are unnumbered, non-sequential lists use unordered bullets (`-`), and numbered lists (`1.`) appear only on true sequential steps.
5. **Include the mandatory live preview URL in the PR description**: Every PR modifying `docs/site/`, `specification/`, or `catalogs/` deploys an automated preview via GitHub Actions. Always include the root preview link and direct deep links to each modified page in the PR description using this exact format (note `/pr-preview/`, not `/preview/`, and include trailing slashes):

   ```markdown
   **Live Preview**: https://a2ui.org/pr-preview/pr-<PR_NUMBER>/

   **Modified pages:**

   - https://a2ui.org/pr-preview/pr-<PR_NUMBER>/<route>/
   ```

6. **Keep the PR description current**: Before squash-merging, update the PR description so it reflects the final merged architecture, routes, and preview links rather than early draft paths.
