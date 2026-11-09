# Specifications, schemas, and AI agent manifests

Apply these rules—alongside the universal standards in [`../SKILL.md`](../SKILL.md)—when working on specification wrapper pages (`docs/site/src/content/docs/specification/`), canonical specifications (`specification/`), `docs/site/llms.txt`, agent Markdown endpoints (`docs/site/src/pages/**/*.md.ts`), or documentation build/bundling scripts (`docs/site/scripts/`).

---

## Specification wrappers and single source of truth

- **Never duplicate specification prose**: Canonical protocol and inference specifications live in `specification/<version>/docs/`, and canonical catalog schemas live in `catalogs/`. Wrapper files under `docs/site/src/content/docs/specification/` must embed canonical content via the remark include directive (`--8<-- "specification/..."` or `--8<-- "catalogs/..."`) rather than copying text into `docs/site/`.
- **Alert syntax in included `.md` specs**: Plain Markdown files under `specification/` use standard GitHub-flavored alerts (`> [!NOTE]`, `> [!IMPORTANT]`, `> [!WARNING]`), which `remark-a2ui-includes.mjs` transforms into Starlight asides at build time (`verify-spec-links.mjs --check-dist` fails if any unexpanded `--8<--` or raw `[!NOTE]` marker leaks into rendered HTML).
- **Strict version status labels (`specification/versions.json`)**:
  - `specification/versions.json` is the machine-readable source of truth for protocol lifecycle status (`release-candidate`, `current`, `previous`, `deprecated`).
  - Follow [`AGENTS.md`](../../../../AGENTS.md#version-labels): display status words (`Release Candidate`, `Current`, `Deprecated`) **only** where readers choose between versions (version tables, spec page titles/badges/top callouts, spec `**Status:**` fields, sidebar labels, and `llms.txt` version summaries).
  - Active specification pages on `docs/site/` cover supported versions (`v1.0`, `v0.9.1`, `v0.9`); deprecated `v0.8` spec pages are intentionally omitted from the Astro site.

---

## Schema publishing and permalink validation

During `prebuild`, `docs/site/scripts/prepare-spec-assets.mjs` copies JSON schemas from `specification/` and `catalogs/` into `docs/site/public/specification/`, flattening `json/*.json` to the version root so canonical `$id` URLs resolve statically.

- **Explorer deep-links vs. canonical `$id` URIs**:
  - In human-facing prose, link to `/specification/<version>/schemas/#<schema-alias>.json/<json-pointer>` (or catalog guide anchors) so readers land in the interactive Schema Explorer.
  - Keep full `https://a2ui.org/specification/...` URLs strictly for JSON `$id` and `$ref` fields.
- **Validation**: `scripts/verify-spec-links.mjs` checks every `--8<--` include path and every `#<schema>.json/<json-pointer>` deep-link against the live JSON schemas during `npm --prefix docs/site run build`.

---

## AI agent manifests (`llms.txt`, `llms-full.txt`, and `.md` endpoints)

`docs/site` treats coding agents and LLM tools as first-class readers through three generated surfaces:

- **Curated entry point (`docs/site/llms.txt`)**:
  - Published at `/llms.txt` and linked in HTML `<head>` via `<link rel="alternate" type="text/markdown" href="/llms.txt">`.
  - Update `docs/site/llms.txt` whenever you add, rename, or remove major documentation sections, guides, quickstarts, or concept pages.
  - Preserve dynamic build placeholders (`{{A2UI_PROTOCOL_VERSIONS}}` and `{{A2UI_SPEC_LINKS}}`), which `prepare-spec-assets.mjs` populates from `specification/versions.json`. Always edit the template at `docs/site/llms.txt`, never the generated copy in `public/`.
  - Only advertise SDK install commands for packages verified as published on npm, PyPI, or pub.dev (clearly mark pre-release or unreleased packages).
- **Full corpus bundle (`llms-full.txt`) and parallel `.md` routes**:
  - `docs/site/scripts/emit-markdown-bundle.mjs` expands `--8<--` directives, strips MDX `import`/`export` statements and JSX wrappers into clean Markdown, writes `llms-full.txt`, and emits parallel raw Markdown mirrors (`<route>.md` and `<route>/index.html.md`) for every documentation page.
  - **Fence-aware MDX cleaning**: If modifying `emit-markdown-bundle.mjs`, always partition content by code fences (`splitByCodeFences()`, supporting 3+ backticks and tildes) before stripping ESM `import`/`export` statements or JSX tags so code examples inside fences remain untouched.
- **Standalone agent playbook endpoints** (`src/pages/**/*.md.ts`):
  - Dynamic Markdown endpoints generate self-contained, copy-ready instructions for coding agents.
  - Normalize source file line endings (`content.replace(/\r\n/g, '\n')`) before parsing section markers, and resolve URLs from `import.meta.env.SITE || 'https://a2ui.org'` combined with `import.meta.env.BASE_URL` so links work in both PR previews and production.
