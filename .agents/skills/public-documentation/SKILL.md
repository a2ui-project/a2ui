---
name: public-documentation
description: >-
  Defines authoring, multi-version tabbing, multi-SDK code example, and diagram
  standards for the A2UI developer site (docs/site/). Use when creating,
  editing, or reviewing public documentation, conceptual guides, tutorials, or
  quickstarts.
---

# Public Documentation Authoring Skill

This skill defines the standards, conventions, and authoring guidelines for creating and editing public documentation, conceptual guides, tutorials, and quickstarts for the A2UI developer website (`docs/site/`).

---

## 1. Tone and Writing Style: Natural and Neutral

Public documentation must read as professional, accurate, and human-authored technical writing.

- **Follow the Natural Writing Skill**: Strictly adhere to [.agents/skills/natural-writing/SKILL.md](../natural-writing/SKILL.md).
- **First-Sentence Purpose Statement**: Each documentation page must start immediately with a natural, concise sentence explaining what is in the page, so readers can stop reading quickly if the page does not cover the information they need. Avoid robotic formulas (such as "This page covers..." or "In this guide..."); use direct, informative framing (e.g. "A2UI separates declarative UI layout from reactive data state through an asynchronous, bidirectional messaging protocol.").
- **Avoid Numbered Headings**: Avoid the use of numbered headings (such as `## 1. ...` or `### 2. ...`) unless the numbers have a special meaning (for example, strict sequential steps in a tutorial, ordered protocol execution phases, or numbered specification clauses). Use descriptive, unnumbered headings instead.
- **Avoid AI-isms and Buzzwords**: Never use banned puffery, hype, or overrepresented words (e.g. _seamlessly_, _robust_, _delve_, _transformative_, _testament_, _tapestry_, _interplay_, _empower_, _leverage_).
- **Direct and Neutral Tone**: State technical facts directly. Use plain copulas ("is", "are") rather than figurative phrasing ("serves as", "stands as"). Write instructions clearly and concisely.
- **Link Key Terms**: Link new concepts or terminology to their formal definition in the glossary or specification on first mention.

---

## 2. Protocol Version Parity in JSON Examples (v1.0 Primary + v0.9 / v0.9.1)

Documentation leads with **v1.0 (Candidate)** while clearly explaining differences from **v0.9 / v0.9.1 (Active)** and including concrete **v0.9 / v0.9.1** samples:

- **Provide Tabbed `v1.0` and `v0.9.1` Examples (`syncKey="protocol-version"`)**:
  Whenever presenting wire format JSON, message payloads (e.g., `createSurface`, `updateDataModel`), transport metadata, or catalog definitions:
  - Place **v1.0 (Candidate)** in the first tab and **v0.9.1 (Active)** in the second tab using `<Tabs syncKey="protocol-version">`.
  - Use exact wire `"version"` values: `"1.0"` (no `"v"` prefix) in v1.0 payloads, and `"v0.9"` (or `"v0.9.1"`; standard v0.9.x examples and `$id` URIs use `v0.9` / `v0_9`) in v0.9.1 payloads.
  - Explicitly call out version-specific renames and structural changes (e.g., `agent_to_renderer` / `renderer_to_agent` vs. `server_to_client` / `client_to_server`, `@path` / `@call` vs. `path` / `call`, and transport metadata keys `a2uiRendererCapabilities` / `a2uiRendererDataModel` under `"1.0"` vs. `a2uiClientCapabilities` / `a2uiClientDataModel` under `"v0.9"`).
- **Express / Wire Mapping**: When contrasting human-readable inference formats (like Express `.a2ui`) with raw JSON, show the resulting compiled JSON for both versions if there are structural differences.

---

## 3. Multi-SDK Code Examples & Strict Tab Ordering

Code examples must not favor a single programming language. Whenever demonstrating SDK integration, surface creation, data binding, or agent communication:

- **Include All Available SDKs**: Always provide code examples for active SDKs supported in the repository. (Note: Swift currently focuses on client-side rendering with Core and SwiftUI, without an Agent SDK. For Agent SDK examples, include TypeScript, Python, and Dart, noting Swift's client focus; for Core state and message processing, include all four).
- **Strict Tab Ordering**: Tabs must **always** appear in the following canonical order:
  1. **TypeScript** (`TS` / Node / Web)
  2. **Python**
  3. **Dart** (Flutter / Dart)
  4. **Swift** (iOS / macOS)

### Tabbed Example Template (Starlight)

Use Starlight `<Tabs>` and `<TabItem>` components with a synchronized `syncKey="sdk-lang"` so a user's language selection remains active across page navigation:

````markdown
import { Tabs, TabItem } from '@astrojs/starlight/components';

<Tabs syncKey="sdk-lang">
  <TabItem label="TypeScript">
  ```typescript
  import { A2uiGenerator, CatalogConfig } from '@a2ui/agent';
  // TypeScript example
  ```
  </TabItem>
  <TabItem label="Python">
  ```python
  from a2ui.processor import A2uiGenerator, CatalogConfig
  # Python example
  ```
  </TabItem>
  <TabItem label="Dart">
  ```dart
  import 'package:a2ui_agent/a2ui_agent.dart';
  // Dart example
  ```
  </TabItem>
  <TabItem label="Swift">
  ```swift
  import A2UICore // Target module from SwiftPM product A2UISwiftCore
  // Swift Core state or client-side example
  ```
  </TabItem>
</Tabs>
````

---

## 4. Multi-Platform Renderer Examples

When documenting client-side UI rendering, catalog registration, or component adapters, represent the supported UI framework renderers in tabs:

1. **Flutter**
2. **Web** (React / Lit / Angular)
3. **SwiftUI**
4. **Jetpack Compose**

---

## 5. Single Source of Truth & Spec Inclusions

- **Never Duplicate Specification Text**: Protocol specifications live in `specification/<version>/docs/`. Docs pages in `docs/site/src/content/docs/specification/` must use the include directive `--8<-- "specification/..."` rather than copy-pasting spec markdown.
- **Link to the JSON Schemas Explorer**: In documentation prose, deep-link to schema definitions via the human-browsable JSON Schemas Explorer permalink contract (`/specification/<version>/schemas/#<schema-file>/<json-pointer>` as defined in `docs/site/SITE_OUTLINE.md`), reserving raw `https://a2ui.org/specification/...` URLs for JSON `$id` / `$ref` fields.
- **Custom Catalogs Disclaimer**: When showing standard or basic catalog components, remind users that A2UI catalogs are flexible and domain-specific—developers can define custom catalogs with their own components.

---

## 6. Diagrams and Visual Aids (Hybrid Pattern)

To balance visual quality with ease of maintenance, public documentation uses a **hybrid diagram pattern**:

- **Preceding Text Explanation (Accessibility & Alternative Representation)**:
  All diagrams on documentation pages (excluding marketing or landing pages) must have an explanatory paragraph immediately before them that explains the content, components, and relationships shown in the diagram. This ensures people who cannot read or view diagrams (including developers using screen readers or text-only browsers) receive the complete conceptual information without visual dependency.
- **Prioritize Simplicity Over Exhaustive Edge Cases**:
  All diagrams must be kept as simple as possible. Prioritize clear, direct mental models over showing every particular edge case, error path, or secondary branching permutation.
- **Visual Layout Verification via Screenshots (Custom Tailwind Diagrams)**:
  When creating or modifying custom Tailwind or Astro diagram components, agents must capture screenshots (or evaluate rendered visual layout in a browser environment) to ensure the design renders cleanly. Pay specific attention to responsive layout across viewport widths, ensuring text never overflows containers, labels do not wrap awkwardly, and badges remain legible.
- **Use Themed Mermaid Sequence Diagrams for Protocol Lifecycles**:
  - _When to use_: Message exchange between Agent and Renderer, client/server event lifecycles, handshake flows, and error handling loops (e.g., `Messages`).
  - _Why_: Sequence diagrams are tedious to create by hand. Plaintext Mermaid blocks are directly diffable in Git and can be updated instantly whenever protocol schemas evolve.
  - _Style_: Ensure diagrams use site typography (`Plus Jakarta Sans` / `JetBrains Mono`) and theme-aware colors matching Starlight's dark/light modes.
- **Use Bespoke MDX / Astro Visual Components (Tailwind) for Conceptual & Structural Overviews**:
  - _When to use_: Structural container models, component anatomy, taxonomy breakdowns, and feature comparisons (e.g., `Catalogs, Components and Functions`, `The Generative UI Spectrum`).
  - _Why_: Standard Mermaid flowchart subgraphs look rigid, academic, and dated. Modern developer portals use styled card layouts with subtle borders, badges, and monospace pills.
  - _How_: Author the documentation page as `.mdx` and import reusable visual Astro components (e.g., from `src/components/docs/`).
- **Use Static Vector Graphics (SVGs) for Fixed Architectural Hero Art**:
  - For complex marketing illustrations or logos, place SVGs under `src/assets/` and import them into the page.

---

## 7. Verification and Pull Request Reviews

Before opening a pull request with new or modified documentation:

1. **Verify Code Accuracy**: Ensure all setup commands, code snippets, class names, and method signatures match the live SDK implementations in the repository.
2. **Audit for Drift**: Run or consult the [`a2ui-doc-sync-check`](../a2ui-doc-sync-check/SKILL.md) skill to confirm no code-docs synchronization drift was introduced.
3. **Style & Tone Check**: Review text against the [`natural-writing`](../natural-writing/SKILL.md) rules to eliminate any AI-isms, copula substitutions, or marketing buzzwords.
4. **Host a Live Review Preview**: When submitting a pull request containing documentation changes, it is strongly preferable to host a live preview for reviewers (for example, deployed via GitHub Pages on a fork or private repo, or via an automated preview deployment). Include a clickable link to the hosted preview directly in the PR description so reviewers can visually inspect formatting, tab synchronization, and responsive rendering.
