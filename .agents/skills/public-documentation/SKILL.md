---
name: public-documentation
description: Guidelines and authoring standards for writing public documentation, concepts, guides, and tutorials for the A2UI developer site.
---

# Public Documentation Authoring Skill

This skill defines the standards, conventions, and authoring guidelines for creating and editing public documentation, conceptual guides, tutorials, and quickstarts for the A2UI developer website (`docs/site/`).

---

## 1. Tone and Writing Style: Natural and Neutral

Public documentation must read as professional, accurate, and human-authored technical writing.

- **Follow the Natural Writing Skill**: Strictly adhere to [.agents/skills/natural-writing/SKILL.md](../natural-writing/SKILL.md).
- **Avoid AI-isms and Buzzwords**: Never use banned puffery, hype, or overrepresented words (e.g. _seamlessly_, _robust_, _delve_, _transformative_, _testament_, _tapestry_, _interplay_, _empower_, _leverage_).
- **Direct and Neutral Tone**: State technical facts directly. Use plain copulas ("is", "are") rather than figurative phrasing ("serves as", "stands as"). Write instructions clearly and concisely.
- **Link Key Terms**: Link new concepts or terminology to their formal definition in the glossary or specification on first mention.

---

## 2. Protocol Version Parity in JSON Examples

A2UI actively supports multiple protocol specifications during the transition from v0.9 to v1.0:

- **Always Provide Both v0.9 and v1.0 Where Relevant**:
  Whenever presenting wire format JSON, message payloads (e.g., `createSurface`, `updateDataModel`), or component definitions:
  - Provide side-by-side or tabbed examples for **v0.9** (current published protocol) and **v1.0** (candidate / next stable release).
  - Explicitly call out version-specific differences, deprecations, or syntax enhancements (e.g. payload envelope evolution, property restructuring).
- **Express / Wire Mapping**: When contrasting human-readable inference formats (like Express `.a2ui`) with raw JSON, show the resulting compiled JSON for both versions if there are structural differences.

---

## 3. Multi-SDK Code Examples & Strict Tab Ordering

Code examples must not favor a single programming language. Whenever demonstrating SDK integration, surface creation, data binding, or agent communication:

- **Include All Available SDKs**: Always provide code examples for every active SDK supported in the repository.
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
  import { AgentClient } from '@a2ui/agent';
  // TypeScript example
````

  </TabItem>
  <TabItem label="Python">
  ```python
  from a2ui_agent import AgentClient
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
  import A2UICore
  // Swift example
  ```
  </TabItem>
</Tabs>
```

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
- **Link to Concrete Catalogs and Schemas**: Point developers directly to canonical schemas published at `https://a2ui.org/specification/...` and source files under `catalogs/`.
- **Custom Catalogs Disclaimer**: When showing standard or basic catalog components, remind users that A2UI catalogs are flexible and domain-specific—developers can define custom catalogs with their own components.

---

## 6. Diagrams and Visual Aids (Hybrid Pattern)

To balance visual quality with ease of maintenance, public documentation uses a **hybrid diagram pattern**:

- **Use Themed Mermaid (`starlight-mermaid`) for Protocol Sequences & Lifecycles**:
  - _When to use_: Message exchange between Agent and Renderer, client/server event lifecycles, handshake flows, and error handling loops (e.g., `Messages and Data`).
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
