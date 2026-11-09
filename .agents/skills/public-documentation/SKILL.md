---
name: public-documentation
description: >-
  Defines authoring, multi-version tabbing, multi-SDK code example, and diagram
  standards for the A2UI developer site (docs/site/). Use when creating,
  editing, or reviewing public documentation, conceptual guides, tutorials, or
  quickstarts.
metadata:
  internal: true
---

# Public documentation authoring skill

This skill defines standards and architectural conventions for authoring public documentation, conceptual guides, tutorials, and quickstarts across the A2UI developer site (`docs/site/`).

---

## Tone, style, and list conventions

Public documentation must read as clear, accurate, and human-authored technical writing.

- **Adhere to natural writing standards**: Follow [.agents/skills/natural-writing/SKILL.md](../natural-writing/SKILL.md). Maintain a neutral tone, use plain copulas ("is", "are") instead of flowery substitutions ("serves as", "stands as"), and avoid promotional puffery or artificial jargon.
- **First-sentence purpose statement**: Every documentation page must open immediately with a clear, informative sentence that explains what the page covers. Avoid formulaic filler such as "This guide will walk you through..." or "In this document, we explore...". State the technical topic directly so readers can quickly determine if the document answers their question.
- **Descriptive, unnumbered headings**: Use unnumbered headings across all documentation pages. Never prefix section titles with artificial numbers (such as `## 1. Introduction` or `### 2. Setup`), except when documenting strict chronological phases or numbered specification clauses.
- **Unordered versus ordered list selection**: Select list formatting based on whether items have an inherent sequence:
  - Use unordered bullet points (`-`) for non-sequential items, including feature summaries, component catalogs, conceptual principles, taxonomic groupings, configuration options, or alternative architectural choices.
  - Use numbered lists (`1.`, `2.`, `3.`) strictly for sequential step-by-step instructions, procedural workflows, chronological timelines, or explicit precedence rankings.
- **Terminology links**: Link key technical concepts and domain terms to their formal definitions in the glossary or specification on first mention.

---

## Guide information architecture and the lean core path

Quickstarts and tutorials guide readers toward a working integration with minimal cognitive friction. Follow the lean core path pattern:

- **Four to five step core path**: Structure the primary walkthrough into four to five concise steps that take the reader from an empty project to a rendering interface.
- **Defer advanced capabilities**: Place topics such as capability negotiation, bidirectional data-model synchronization, custom themes, and client-side validation rules in an "Additional steps" or "Next steps" section after the core flow.
- **Remove upfront theoretical roadblocks**: Do not place protocol sequence diagrams, architectural taxonomy charts, or version comparison tables before Step 1. Introduce conceptual background only after the developer runs the base sample.
- **Application code first**: Present application code, components, and event listeners before raw transport payloads. Place supporting wire JSON envelopes in collapsible `<details>` blocks after the application code.
- **No Missing Glue rule**: Provide a complete bootstrap file at the end of the guide (such as `App.tsx`, `main.dart`, `MyApp.swift`, or `MainActivity.kt`) that imports the created components and mounts the surface.
- **Include essential packages by default**: Include companion packages required for standard presentation (such as `@a2ui/markdown-it` for Markdown rendering) in setup commands and imports from the beginning, rather than introducing them as troubleshooting fixes later.

---

## Protocol version focus and label strictness

Documentation leads with protocol version **v1.0**, the current protocol version, while providing accurate version references for earlier releases.

- **Lead with v1.0 in prose**: All conceptual explanations, architectural walkthroughs, and tutorial instructions focus on v1.0 syntax and data structures.
- **Isolate platform version deviations**: If a client framework package targets an earlier protocol release (for example, Jetpack Compose `1.0.0-alpha02` targeting `v0.9.1`), isolate that difference inside that platform's tab or in an adjacent `<Aside type="note">` callout. Do not dilute the rest of the guide with legacy explanations.
- **Plain version tab labels**: In version comparison tabs, use plain version labels strictly (`label="v1.0"` and `label="v0.9.1"`). Never append status words or release stages (such as `v1.0 (Candidate)` or `v0.9.1 (Stable)`).
- **Document v1.0-exclusive capabilities cleanly**: When presenting capabilities available only in v1.0, show an untabbed v1.0 code block accompanied by an `<Aside type="note" title="New in v1.0">` callout rather than an empty or disabled comparative tab.
- **Accurate wire payload values**: In JSON snippets, reflect exact protocol identifiers:
  - Use `"version": "1.0"` (without a `"v"` prefix) for v1.0 envelopes.
  - Use `"version": "v0.9"` or `"v0.9.1"` for v0.9.x envelopes.
  - Reflect renamed keys accurately, such as `agent_to_renderer` / `renderer_to_agent` versus `server_to_client` / `client_to_server`, and `@path` / `@call` versus `path` / `call`.

---

## Multi-SDK and multi-framework tab synchronization

Provide balanced code samples across all supported languages and UI frameworks using Starlight tabs configured with standardized synchronization keys.

### Standardized syncKey identifiers and tab ordering

Use the following predefined `syncKey` values and ordering sequences:

- **`syncKey="sdk-lang"`**: Used for agent and server-side SDK examples. Order tabs as:
  - TypeScript
  - Python
  - Dart
  - Swift (omit Swift for agent-only SDK examples, as Swift focuses on client-side Core and SwiftUI).
- **`syncKey="renderer-framework"`**: Used for complete cross-platform UI renderer examples covering all six supported platforms:
  - Flutter
  - React
  - Lit
  - Angular
  - SwiftUI
  - Jetpack Compose
- **`syncKey="web-framework"`**: Used for web-specific renderer examples covering the three web adapters:
  - React -> Lit -> Angular (or Lit -> React -> Angular when Lit is the primary reference).
  - Do not use `renderer-framework` on a three-tab web snippet, as doing so desynchronizes mobile tabs across the site.
- **`syncKey="client-sdk"`**: Used for client state model and transport handling SDKs:
  - TypeScript
  - Dart
  - Swift
- **`syncKey="protocol-version"`**: Used for wire JSON message payloads and catalog definitions:
  - v1.0
  - v0.9.1

### Expressive Code framing hygiene

When annotating code snippets within tabs:

- Provide clean, valid file path comments or titles across all tabs in a group (for example, `// src/agent.ts`, `# src/agent.py`, `// lib/agent.dart`), or omit titles entirely across the group.
- Avoid mixing titled files with untitled code blocks within the same tab group.

---

## Starlight and MDX component standards

Documentation pages use Astro Starlight components and MDX syntax.

- **Explicit imports**: Import every Starlight component at the top of the MDX file:
  ```typescript
  import {Aside, Badge, Steps, Tabs, TabItem} from '@astrojs/starlight/components';
  ```
- **Callout syntax**: Use the Starlight `<Aside>` component for notices and warnings:
  - `<Aside type="note" title="...">`: Background explanations or version availability notices.
  - `<Aside type="tip" title="...">`: Performance improvements or practical recommendations.
  - `<Aside type="caution" title="...">`: Potential pitfalls or deprecation advisories.
  - `<Aside type="danger" title="...">`: Security risks, breaking changes, or critical configuration errors.
- **HTML-like tag escaping in MDX**: MDX parses unquoted HTML tags as JSX components. Always wrap literal tag names in backticks (such as `<script>`, `<link>`, or `<a2ui-surface>`) when mentioning them in prose, or escape them with entity references (`&lt;script&gt;`) inside code samples.
- **Sequential tutorials with `<Steps>`**: Wrap procedural tutorial steps in `<Steps>` to render numbered step indicators automatically:
  ```mdx
  <Steps>
    1. Install the SDK packages. 2. Configure your component catalog. 3. Initialize the surface. 4.
    Mount the root application component.
  </Steps>
  ```
- **Status indicators with `<Badge>`**: Use `<Badge text="..." variant="note|tip|caution|danger|success" />` for inline status markers.

---

## Single source of truth and linking standards

Maintain a consistent URL structure and link graph across all documentation pages.

- **Relative internal links**: Use strictly relative file paths for links between documentation pages (such as `../concepts/overview/` or `./catalog-registration/`).
- **Schema permalink exception**: Link to formal protocol schemas and schema exploration interfaces using root-relative permalinks:
  - Direct schema files: `/specification/v1_0/json/...`
  - Interactive schema explorer: `/specification/v1_0/schemas/#<schema-file>/<json-pointer>`
- **No raw source repository blobs**: Never link to raw GitHub blob URLs (`https://github.com/.../blob/...`) for files published on the documentation site. Link to the rendered documentation page instead.
- **No unready or draft links**: Do not link to placeholder routes, unmerged documentation pages, or unpublished drafts.
- **Automated link verification**: Run the automated link checker during the site build (`npm --prefix docs/site run build`), which executes `check-links.mjs` to validate all internal links and anchor fragments.

---

## Diagrams, visual aids, and Astro components

Visual diagrams help explain architectural concepts and protocol interactions while maintaining accessibility.

- **Preceding explanatory text (Hybrid diagram pattern)**:
  Every diagram must be preceded by an explanatory paragraph describing the components, data flow, and architectural relationships shown. This ensures that users who rely on screen readers or text-only browsers receive complete conceptual information without visual dependency.
- **Diagram simplicity**:
  Focus diagrams on the core mental model and the happy path. Avoid crowding diagrams with every minor error handler, retry branch, or low-level transport detail.
- **Canonical diagram container**:
  Wrap custom visual diagrams in `<DiagramCard>` with an accompanying machine-readable Mermaid specification:

  ```mdx
  import DiagramCard from '../../../components/docs/common/DiagramCard.astro';

  <DiagramCard
    title="Surface Lifecycle"
    mermaid={`
      sequenceDiagram
        Agent->>Renderer: createSurface
        Agent->>Renderer: updateDataModel
        Renderer->>Agent: userAction
    `}
  >
    {/* Visual card content or SVG */}
  </DiagramCard>
  ```

- **Container queries for responsive layouts**:
  Use CSS container queries (`@container (min-width: ...)`) rather than viewport media queries (`@media (min-width: ...)`) for custom diagram components so cards adapt cleanly whether rendered in full-width pages or constrained multi-column layouts.
- **Design system tokens**:
  Reference global tokens from `src/styles/tokens.css` (such as `var(--font-body)`, `var(--a2-border)`, `var(--a2-surface)`, and `var(--a2-text)`) to maintain consistent typography and colors across light and dark modes.
- **Scoped component styles**:
  Never use `<style is:inline>` in documentation components. Use scoped `<style>` blocks in Astro components to prevent style leaks across pages.
- **Defensive client-side scripts**:
  When embedding client-side scripts in interactive components:
  - Wrap `localStorage` or `sessionStorage` access in `try...catch` blocks to prevent crashes in private browsing modes or restricted sandboxes.
  - Check `if (e.isTrusted)` before triggering pointer capture or synthetic events.

---

## Code snippet robustness and runtime lifecycle

Code examples in documentation must demonstrate sound resource management and framework lifecycles.

- **React hook hygiene**:
  - Store callbacks referenced inside `useMemo` in a `useRef` to maintain stable reference identity across renders.
  - Dispose of message processors and subscriptions in the cleanup function of `useEffect` (`return () => { processor.dispose(); };`).
- **Lit component lifecycle**:
  Subscribe to state streams and data stores in both `connectedCallback` and `willUpdate` to handle both initial mounting and subsequent property modifications cleanly, and unsubscribe in `disconnectedCallback`.
- **Multi-turn agent state**:
  When illustrating multi-turn agent interactions, emit subsequent surface updates with `update=true` (such as `surface(..., update=true)`) rather than recreating the surface from scratch.
- **Defensive client transport handling**:
  In fetch transport examples, verify `if (!response.ok)` before reading data, and verify that the response body is non-empty before calling `JSON.parse`.

---

## AI agent manifests and markdown bundles

The documentation site generates machine-readable endpoints for AI assistants, LLM tools, and offline readers.

- **Curated `llms.txt`**:
  Maintain `docs/site/llms.txt` with concise project summaries, quick links, and official package install commands. Place build-time placeholders (such as `{{A2UI_PROTOCOL_VERSIONS}}`) where dynamic protocol lists are injected during build.
- **Fence-aware MDX cleaning for `llms-full.txt`**:
  The build script `emit-markdown-bundle.mjs` generates `docs/site/dist/llms-full.txt`. When adding custom components, ensure component tags outside code fences are clean and parseable so the extraction pipeline strips MDX wrappers without corrupting code blocks.
- **Parallel Markdown endpoints**:
  The site serves raw Markdown versions of all documentation pages by appending `.md` to any documentation URL (for example, `/quickstart.md` or `/concepts/overview.md`). Avoid syntax patterns that render Markdown unintelligible when stripped of Astro components.

---

## Verification and pull request reviews

Follow this verification procedure before opening or updating documentation pull requests:

1. **Verify code accuracy**: Confirm that package names, import statements, type names, and API signatures match the current codebase.
2. **Validate JSON examples**: Run the schema validator across all documentation files:
   ```bash
   python3 docs/scripts/validate_doc_examples.py
   ```
3. **Build the site and check links**: Build the documentation site locally to verify MDX parsing and link integrity:
   ```bash
   npm --prefix docs/site run build
   ```
4. **Conduct a style and tone audit**: Review all added or updated text against [.agents/skills/natural-writing/SKILL.md](../natural-writing/SKILL.md). Check that:
   - Headings are descriptive and unnumbered.
   - Non-sequential lists use bullet points (`-`).
   - Procedural workflows use numbered steps (`1.`, `2.`, `3.`).
   - Promotional buzzwords and filler phrases are removed.
5. **Add the mandatory live preview link to the PR description**:
   Every pull request with documentation changes must include the live preview URL in its description:
   ```markdown
   **Live Preview**: https://a2ui.org/pr-preview/pr-<PR_NUMBER>/
   ```
6. **Provide direct deep links**: List clickable preview links to each modified page in the PR description so reviewers can inspect changes directly.
7. **Refresh before squash-merging**: Update the PR description before final merging to reflect any structural edits or new pages added during the review process.
