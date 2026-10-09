# Subskill: Public API Boundaries, Cross-Framework Design & Changelogs

## Activation Criteria

Activate this subskill when:

- PR modifies package entrypoints or facades (`index.ts`, `public-api.ts`, `package.json` `exports`, `__init__.py`, `lib/*.dart`, or `public` Swift declarations) or `CHANGELOG.md`.
- PR adds, renames, moves, or deprecates exported classes, functions, types, interfaces, models, or DI tokens.
- PR modifies renderer or SDK APIs, registration helpers, or adapters in `@a2ui/angular`, `@a2ui/lit`, `@a2ui/react`, `a2ui_flutter`, or `A2UISwiftUI`.
- PR adds or modifies imports across sibling packages (e.g., between core packages and framework adapters).
- PR modifies or introduces shared schemas, JSON fixtures, or examples in `specification/` or `catalogs/`.
- PR adds or updates navigation, hotkeys, or layout capabilities in sample clients or framework explorers (`a2ui_explorer`).
- PR adds new source files to any package.

---

## Principles

### 1. Audit Public API Changes for Cross-Framework & Cross-SDK Alignment

- **Problem & Rationale**: A2UI provides multi-language SDKs and multi-framework renderers (Angular, Lit, React, Flutter, SwiftUI). When each package invents its own distinct function names, parameter structures, or registration hooks for identical concepts, developer ergonomics suffer, mental models fracture, and documentation becomes inconsistent. Furthermore, changes to the public API surface cannot be reliably audited through raw diffs or naive text searches alone when re-export barrels obscure what is exposed.
- **Actionable Guidance**:
  - When reviewing or authoring changes in any SDK or renderer PR, first determine the exact public API delta (added, removed, and modified symbols).
  - For TypeScript packages (`@a2ui/angular`, `@a2ui/lit`, `@a2ui/react`, `@a2ui/web_core`, `@a2ui/a2ui_agent`), use an AST-based analysis (`ts-morph`) on package entry points (`package.json` `exports` and `ng-package.json`) to resolve re-export chains and compare exported symbols between the PR branch and the base commit. See [Inspecting TypeScript Public API (AST Approach)](typescript/references/inspecting-typescript-public-api.md).
  - For Python packages (`python/`), check `__all__` in root and versioned `__init__.py` facades (see [`a2ui-python-development`](../../a2ui-python-development/SKILL.md)).
  - Once the public API delta is established, inspect the equivalent API surfaces in sibling renderers or SDKs, compare method names, signatures, and configuration options, and align them symmetrically.
- **Reviewer Checklist**:
  - [ ] Map package entry points to identify touched public barrels.
  - [ ] For TypeScript packages, run an AST-based export diff (`ts-morph`) between the PR branch and its base to resolve re-exports and extract added, removed, and modified declarations (see [Inspecting TypeScript Public API (AST Approach)](typescript/references/inspecting-typescript-public-api.md)).
  - [ ] Audit added symbols to confirm they are intentional public additions rather than accidental leaks of internal helpers.
  - [ ] Audit removed symbols to confirm they do not introduce unannotated breaking changes.
  - [ ] Verify that matching concepts share identical naming across sibling framework renderers (e.g. `createComponentImplementation`, not `createAngularComponentImplementation` or `createLitComponent`).
  - [ ] Flag unnecessary framework-specific wrapper type aliases that merely rename core types without adding specialization.

---

### 2. Explicitly Enumerate Named Exports in Public Entrypoints (Reject Wildcard Exports)

- **Problem & Rationale**: Wildcard exports (`export * from '...'` in TypeScript, `from ... import *` in Python) obscure the public API surface, cause accidental leaks of internal helper symbols, risk name collisions across submodules, and degrade IDE autocomplete. Explicit named exports ensure that all additions to a package's public surface are intentional, reviewed, and tracked.
- **Reviewer Checklist**:
  - [ ] Reject `export * from '...'` in any `index.ts` or `public-api.ts` file, and reject wildcard imports/exports in Python `__init__.py` facades.
  - [ ] Require explicit named export lists (`export { SymbolA, type SymbolB } from '...'` in TypeScript; explicit `__all__` in Python).
  - [ ] Verify that every newly exported symbol is documented in `CHANGELOG.md`.

```typescript
// BAD: Wildcard export leaks internal helpers and implementation details
export * from './catalog/helpers.js';
export * from './internal/types.js';

// GOOD: Curated, explicit named exports
export {
  createComponentImplementation,
  type WebComponentImplementation,
} from './catalog/create_component_implementation.js';
```

---

### 3. Prohibit Cross-Package Pass-Through Re-Exports

- **Problem & Rationale**: Re-exporting core contracts (e.g. exporting `@a2ui/web_core` types or helpers from `@a2ui/angular` or `@a2ui/lit`, or re-exporting `a2ui_core` internals from adapter packages) creates redundant indirection, fragments import paths across the ecosystem, and complicates tree-shaking and package boundaries. Consumers should import core contracts directly from the authoritative source package.
- **Reviewer Checklist**:
  - [ ] Check imports and exports across sibling packages.
  - [ ] If a symbol originates in `@a2ui/web_core` (or `a2ui_core` / `A2UICore`), require consumers to import directly from that core package.
  - [ ] Reject pass-through proxy shims in framework renderers unless there is genuine framework-specific specialization.

```typescript
// BAD: Re-exporting core types from framework renderer packages
// renderers/angular/src/v0_9/index.ts
export type {MarkdownRendererOptions} from '@a2ui/web_core/v0_9';

// GOOD: Framework packages export only their own adapters; consumers import core directly
import {provideA2Ui} from '@a2ui/angular/v0_9';
import type {MarkdownRendererOptions} from '@a2ui/web_core/v0_9';
```

---

### 4. Avoid Generic Catch-All Files (`types.*`, `helpers.*`, `utils.*`); Enforce Single Responsibility

- **Problem & Rationale**: Catch-all files such as `types.ts`, `helpers.ts`, `utils.ts` (or `utils.py`, `helpers.dart`) attract unrelated code over time. Disparate types, helper functions, and interfaces accumulate in one place, creating circular dependencies, obscuring ownership, and making targeted unit testing harder. Every file should have a single, well-defined responsibility with its types and implementation co-located, accompanied by a unit test file scoped to that responsibility.
- **Reviewer Checklist**:
  - [ ] Reject new generic catch-all files (`types.*`, `helpers.*`, `utils.*`, `common.*`).
  - [ ] Require files to be organized by domain responsibility (e.g. `create_component_implementation.ts`, `is_web_component.ts`).
  - [ ] Verify that any executable module is accompanied by a focused unit test file.

```text
BAD:
src/
  types.ts        <-- 400 lines of disparate interfaces, type guards, and factory functions
  utils.ts        <-- Grab-bag of string helpers, DOM checks, and color formatters

GOOD:
src/
  create_component_implementation.ts
  create_component_implementation.test.ts
  is_web_component.ts
  is_web_component.test.ts
```

---

### 5. Encapsulate Leaf Dependencies Within Components or Delegate to the Host App

- **Problem & Rationale**: Injecting specialized services or context dependencies (such as Markdown rendering contexts or syntax highlighters needed only by text elements) into top-level container hosts (`ComponentHostComponent`, `SurfaceComponent`, or root surface views) violates separation of concerns and couples generic container hosts to specific leaf components.
- **Reviewer Checklist**:
  - [ ] Verify whether a dependency provided or injected in a generic host component is needed by all components or only by a specific leaf component.
  - [ ] Move leaf-specific dependencies inside the component that requires them, or require the host application to provide the service via dependency injection.

---

### 6. Prefer Configuration Objects or Named Parameters Over Positional Parameters

- **Problem & Rationale**: Functions with multiple positional parameters or polymorphic overloads (`fn(name, versionOrOptions)`) reduce readability at the call site and make evolving the API without breaking existing callers difficult.
- **Corollary**: When a function or method accepts multiple parameters, prefer a configuration object with named properties (in TypeScript) or keyword-only / named arguments (in Python, Dart, and Swift). This keeps call sites readable and allows adding optional parameters over time without migrating existing callers.
- **Reviewer Checklist**:
  - [ ] Flag functions with more than two positional parameters or ambiguous boolean/numeric positional parameters.
  - [ ] Refactor to a configuration object parameter (`fn({ name, version, ...options }: Options)`) or named parameters.

```typescript
// BAD: Positional arguments are ambiguous at the call site and rigid to evolve
function registerCatalog(name: string, isDefault?: boolean, version?: string, timeout?: number) { ... }
registerCatalog('main', true, 'v0.9', 5000); // What do true and 5000 mean?

// GOOD: Configuration object with named properties
interface CatalogRegistrationOptions {
  name: string;
  isDefault?: boolean;
  version?: string;
  timeoutMs?: number;
}
function registerCatalog(options: CatalogRegistrationOptions) { ... }
registerCatalog({ name: 'main', isDefault: true, version: 'v0.9' });
```

---

### 7. Author Shared Specification Examples with Framework-Agnostic Terminology

- **Problem & Rationale**: Examples under `specification/**/examples/` are the source of truth for cross-framework and cross-language conformance tests. Naming files or JSON payloads after specific frameworks (e.g. `angular-grid.json`) creates confusion and discourages reuse across other SDKs and renderers.
- **Reviewer Checklist**:
  - [ ] Check file names and JSON metadata in `specification/**/examples/`.
  - [ ] Verify that all filenames and title attributes describe the UI pattern or functionality neutrally (e.g. `37_native-grid.json` instead of `37_angular-grid.json`).

---

### 8. Never Mutate Released Specification Schemas to Satisfy Local Tests

- **Problem & Rationale**: Released specification versions (such as `v0_8`, `v0_9`, and `v0_9_1`) represent stable, published contracts between agents, servers, and client renderers. Modifying frozen schemas or injecting ad-hoc properties to make a local test pass introduces breaking wire protocol drift.
- **Reviewer Checklist**:
  - [ ] Scrutinize any change inside `specification/`.
  - [ ] Reject modifications to released schema files unless part of an approved protocol change across all implementations.

---

### 9. Synchronize Ergonomics and Feature Parity Across Sample Clients & Explorers

- **Problem & Rationale**: Sample clients and explorer apps demonstrate reference implementations. Divergence in keyboard shortcuts, layout capabilities, or theme handling creates friction for developers testing multi-framework applications.
- **Reviewer Checklist**:
  - [ ] When UX or ergonomic features are introduced in one explorer or sample client, verify whether companion updates or follow-up tasks are needed across sibling clients.

---

### 10. Scope `CHANGELOG.md` Strictly to Public Package Consumers

- **Problem & Rationale**: Package changelogs are published in package releases (`npm`, `PyPI`, `pub.dev`) for end users. Including internal refactorings, sample application changes, private types, or formatting sweeps creates noise for library consumers.
- **Actionable Guidance**: Follow [`update-changelog`](../../update-changelog/SKILL.md) (and [`a2ui-dart-versioning`](../../a2ui-dart-versioning/SKILL.md) for `dart/` packages).
- **Reviewer Checklist**:
  - [ ] Only document changes that alter published APIs, consumer-observable behavior, or dependencies.
  - [ ] Never add changelog entries for internal demo/explorer apps in library package changelogs.
  - [ ] Add the changelog entry to the specific package modified, under `## Unreleased`.
  - [ ] Never delete a `## <version>` header or an already-released entry when resolving merge conflicts or inserting under `## Unreleased`.
  - [ ] Prefix breaking API or behavioral changes with `**BREAKING CHANGE**:` (or `Breaking:` in `dart/` packages) and include a concise migration note.

---

### 11. Keep PR Descriptions Synchronized with Public API Changes as the PR Evolves

- **Problem & Rationale**: Pull requests often evolve through review feedback. If the PR description is written once and left stale after symbols are renamed or removed, reviewers and release notes become inaccurate.
- **Reviewer Checklist**:
  - [ ] Whenever the public API surface or design approach changes during review iteration, update the PR title and description to match the current diff.
