# Refactoring Findings

This file contains notes and edge cases encountered by the subagents during the barrel export refactoring process.

### `renderers/web_core/src/v0_9/schema/index.ts`
- File had already been converted from wildcard exports (`export *`) to explicit named and type-only exports (`common-types.js`, `server-to-client.js`, `client-capabilities.js`, `client-to-server.js`).
- Refactor script verified 0 remaining wildcard exports; no duplicate export collisions or API surface mismatches detected.

## `renderers/react/visual-parity/fixtures/index.ts`
- **Refactoring Status**: Successfully refactored `export * from './components'` and `export * from './nested'` into explicit named exports.
- **Edge Cases & Findings**:
  - **`ENOBUFS` Buffer Overflow in `refactor.cjs`**: `execSync` invoking `find` without `-prune` on `node_modules` across the parent directory containing multiple git worktrees exceeded Node's default 1MB `maxBuffer` limit (`spawnSync /bin/sh ENOBUFS`), causing the script to fail when file paths exceeded 1.1MB.
  - **Concurrency Contention**: Simultaneous execution across subagents caused high CPU usage during full directory tree scanning and potential git index lock conflicts (`index.lock`).
  - **Fixture Aggregation**: The file re-exports both individual fixtures and aggregated dictionaries (`allFixtures`) plus derived type exports (`FixtureName`); explicit re-exports correctly preserve the full surface without name collisions.

## `renderers/web_core/src/v0_9/basic_catalog/index.ts`
- **Refactoring Status**: Verified explicit named exports for all catalog components, functions, expressions, directives, and types. No remaining wildcard (`export *`) statements exist in the file.
- **Edge Cases & Findings**:
  - **API Surface Equivalence**: Verified against `pre_snapshot.json` using `ts-morph` AST extraction. All 120 exported symbols match the baseline snapshot identically (`Equal? true`).
  - **`ENOBUFS` in `refactor.cjs`**: When executed from the worktree root, `process.cwd() + '/..'` caused `find` to recurse into all sibling worktrees in `.bare/`, overflowing Node's default 1MB buffer. Updated `refactor.cjs` to target the worktree root correctly and provide `{ maxBuffer: 50 * 1024 * 1024 }`.

## `renderers/react/visual-parity/fixtures/components/index.ts`
- **Refactoring Status**: Successfully refactored all component wildcard exports (`export * from './<component>'`) into explicit named exports and eliminated duplicate identifier exports.
- **Edge Cases & Findings**:
  - **Duplicate Identifier Exports (TS2300)**: The original file contained wildcard exports (`export * from './text'`, etc.) followed by a trailing `// Re-export fixture groups` block that explicitly re-exported group dictionaries (`export {textFixtures} from './text';`). When wildcards were expanded into explicit named exports, each `<component>Fixtures` symbol was exported in both places, producing 17 `TS2300: Duplicate identifier` errors. Deduplicated by consolidating `multipleChoiceFixtures` into `./multipleChoice` and removing the redundant trailing re-export block.
  - **API Surface Verification**: Verified 100% equivalence against `pre_snapshot.json` baseline across all 77 exported symbols (`Matches exactly: true`).
  - **`ENOBUFS` in `refactor.cjs`**: Encountered `spawnSync /bin/sh ENOBUFS` when executing `refactor.cjs` due to `execSync` running `find` across the parent directory containing multiple worktrees without a raised `maxBuffer`.

## `renderers/angular/src/public-api.ts`
- **Refactoring Status**: Successfully refactored `export * from './v0_8/public-api'` into explicit named and type-only exports.
- **Edge Cases & Findings**:
  - **`v0_8` Module Target**: Even though `v0_8` directories were excluded from refactoring targets, the root Angular barrel `renderers/angular/src/public-api.ts` forwards exports from `./v0_8/public-api`. The refactor script correctly traced and expanded all 38 exported symbols (including `type A2UIClientEvent`, `type DispatchedEvent`, etc.) into explicit exports with 100% API surface equivalence.
  - **`ENOBUFS` Buffer Overflow in `refactor.cjs`**: Encountered `Error: spawnSync /bin/sh ENOBUFS` on initial run because `execSync` ran `find` on `process.cwd() + '/..'` traversing all sibling worktrees without an expanded `maxBuffer`. Resolved by fixing `repoRoot` resolution and setting `{ maxBuffer: 50 * 1024 * 1024 }`.

## `tools/composer/src/data/gallery/index.ts`
- **Refactoring Status**: Successfully refactored `export * from './v08'` and `export * from './v09'`.
- **Edge Cases & Findings**:
  - **Removed Redundant Duplicate Exports**: The file already explicitly exported `export {V08_GALLERY_WIDGETS} from './v08'` and `export {V09_GALLERY_WIDGETS} from './v09'`. Since `./v08` only exports `V08_GALLERY_WIDGETS` and `./v09` only exports `V09_GALLERY_WIDGETS`, the trailing wildcard re-exports (`export * from './v08'` and `export * from './v09'`) only duplicated those existing exports. The script logged `[INFO] Removed duplicate export: 'V08_GALLERY_WIDGETS' from './v08'` and `[INFO] Removed duplicate export: 'V09_GALLERY_WIDGETS' from './v09'`, and cleanly removed the redundant wildcard export lines.
  - **API Surface Verification**: Verified 100% equivalence against `pre_snapshot.json` (`['V08_GALLERY_WIDGETS', 'V09_GALLERY_WIDGETS']`).
  - **`ENOBUFS` in `refactor.cjs`**: Encountered `spawnSync /bin/sh ENOBUFS` on initial run due to `execSync` running `find` on `process.cwd() + '/..'` traversing all sibling worktrees without a raised `maxBuffer`.
## `samples/community/client/angular/projects/a2a-chat-canvas/src/index.ts`
- **Refactoring Status**: Successfully refactored all 4 wildcard exports (`./lib/a2a-chat-canvas`, `./lib/interfaces/a2a-service`, `./lib/services/canvas-service`, `./lib/config`) into explicit named and type-only exports.
- **Edge Cases & Findings**:
  - **API Surface Verification**: Verified 100% equivalence before and after refactoring across all 21 exported symbols.
  - **Type-Only Exports**: Successfully extracted and tagged TypeScript types (`type A2aService`, `type ChatCanvasFeature`, `type MarkdownFeature`, `type A2aFeature`, `type ArtifactResolverFeature`, `type PartResolverFeature`, `type RendererFeature`, `type A2uiFeature`, `type ChatCanvasFeatures`) distinctly from value/class/enum declarations (`A2aChatCanvas`, `A2A_SERVICE`, `CanvasService`, `configureChatCanvasFeatures`, helper functions, `ChatCanvasFeatureKind`).
  - **No Duplicate Exports**: No duplicate identifier collisions or removed duplicates were found across the constituent modules.
## `renderers/angular/src/v0_9/index.ts`
- **Refactoring Status**: Successfully refactored all 28 wildcard exports (`./core/*`, `./catalog/*`, `./catalog/basic/*`) into explicit named and type-only exports.
- **Edge Cases & Findings**:
  - **No Duplicate Exports**: All 46 exported symbols across services, components, models, and catalog widgets are completely unique; no collisions or duplicate exports were detected.
  - **API Surface Verification**: Verified 100% equivalence before and after refactoring across all 46 exported symbols.
  - **Type-Only vs Value Exports**: Accurately tagged TypeScript interfaces/types (`type RendererConfiguration`, `type Child`, `type ComponentTemplate`, `type BoundProperty`, `type ExtendedProps`, `type ComponentApiToProps`, `type MarkdownRendererOptions`, `type AnyDuringSchemaAlignment`, `type AngularComponentImplementation`, `type BasicCatalogOptions`) distinctly from concrete values, functions, injection tokens, and component classes.
  - **JSDoc Trivia Replacement Edge Case**: Replacing the first export statement via `exportDecl.replaceWithText(...)` in `ts-morph` stripped the attached leading trivia containing the module-level JSDoc comment (`/** @module v0.9 ... */`) and section header comment (`// Core Services and Components`). Restored both comment blocks to maintain documentation integrity.
  - **`ENOBUFS` in `refactor.cjs`**: Encountered `spawnSync /bin/sh ENOBUFS` on initial execution when `execSync` ran `find` on `process.cwd() + '/..'` across all sibling worktrees without a raised `maxBuffer`.

## `renderers/react/visual-parity/fixtures/nested/index.ts`
- **Refactoring Status**: Successfully refactored `export * from './layouts'` into explicit named exports and eliminated duplicate identifier exports.
- **Edge Cases & Findings**:
  - **Duplicate Identifier Export (TS2300)**: The original file contained a wildcard export `export * from './layouts';` followed by an explicit re-export `export {nestedFixtures} from './layouts';`. When the wildcard was refactored into explicit named exports, `nestedFixtures` was included in the newly generated export list AND retained in the trailing export statement, producing `error TS2300: Duplicate identifier 'nestedFixtures'`. Deduplicated by consolidating `nestedFixtures` into the single explicit export statement and removing the redundant duplicate statement.
  - **API Surface Verification**: Verified 100% equivalence before and after refactoring across all 8 exported symbols (`nestedCardInList`, `nestedColumnInRow`, `nestedDashboard`, `nestedFixtures`, `nestedForm`, `nestedProfile`, `nestedRowInColumn`, `nestedSettings`).
  - **`ENOBUFS` in `refactor.cjs`**: Encountered `spawnSync /bin/sh ENOBUFS` on initial run due to `execSync` running `find` across the parent directory containing multiple worktrees without a raised `maxBuffer`.
  - **Targeted Workspace Typecheck**: Ran local `npx tsc --noEmit` in `renderers/react/visual-parity`, verifying that all duplicate identifier errors in `nested/index.ts` are resolved.

## `renderers/web_core/src/v0_9/nodes/node-resolver.test.ts`
- **Refactoring Status**: No changes required. The file is a unit test suite and does not contain any wildcard barrel exports (`export * from ...`). The refactoring script processed the file and modified 0 files.
- **Edge Cases & Findings**:
  - **No Exports**: The test file defines test suites and assertions with no module export declarations; no barrel refactoring was needed.

## `renderers/react/src/types.ts`
- **Refactoring Status**: Successfully verified explicit named and type-only exports re-exporting from `./v0_8/types`.
- **Edge Cases & Findings**:
  - **`isolatedModules` Type-Only Re-export (TS1448)**: When `refactor.cjs` generated the initial explicit export list, `Types` and `Primitives` were re-exported without the `type` modifier (`export { Types, Primitives, ... }`). Because they originate from `export type {Types, Primitives}` in `./v0_8/types.ts` (namespaces imported via `import type * as Types`), TypeScript with `isolatedModules` enabled threw `error TS1448: 'Types' resolves to a type-only declaration and must be re-exported using a type-only re-export when 'isolatedModules' is enabled`. The script's AST detection failed to detect them as type-only because `decl.isTypeOnly()` on `ExportSpecifier` returns `false` when the `type` keyword resides on the enclosing `ExportDeclaration` (`export type { ... }`). Resolved by prefixing them with `type` (`type Types, type Primitives`).
  - **Typecheck & Lint Verification**: Ran `yarn workspace @a2ui/react typecheck`, `yarn workspace @a2ui/react format:check`, and `yarn workspace @a2ui/react lint`, all passing with 0 errors.
  - **`ENOBUFS` in `refactor.cjs`**: Encountered `spawnSync /bin/sh ENOBUFS` on initial run when `execSync` ran `find` on `process.cwd() + '/..'` traversing all sibling worktrees in `.bare/`. Resolved when `refactor.cjs` was updated with `{ maxBuffer: 50 * 1024 * 1024 }` and scoped to `repoRoot`.

## `renderers/react/src/styles/index.ts`
- **Refactoring Status**: Successfully verified explicit named exports for all style utilities and variables re-exported from `../v0_8/styles/index`. No wildcard (`export *`) exports remain.
- **Edge Cases & Findings**:
  - **`v0_8` Module Target**: The barrel re-exports from `../v0_8/styles/index`. While `v0_8` directories themselves are excluded from refactoring targets, the barrel file in `renderers/react/src/styles/index.ts` explicitly re-exports all 4 concrete runtime symbols (`injectStyles`, `removeStyles`, `structuralStyles`, `componentSpecificStyles`).
  - **API Surface Verification**: Verified 100% equivalence against `pre_snapshot.json` (`['componentSpecificStyles', 'injectStyles', 'removeStyles', 'structuralStyles']`) using `ts-morph` AST extraction.
  - **No Duplicate Exports**: All 4 exported symbols are unique; no duplicate exports or collisions were encountered.
  - **Typecheck & Lint Verification**: Ran local `yarn typecheck`, Prettier format check, and ESLint in `renderers/react`, all passing with 0 errors.

## `renderers/react/src/v0_9/index.ts`
- **Refactoring Status**: Successfully refactored all 3 wildcard exports (`./A2uiSurface`, `./adapter`, `./catalog/basic`) into explicit named and type-only exports.
- **Edge Cases & Findings**:
  - **Single-File Target Module Resolution**: When `targetFile` was passed to `refactor.cjs`, filtering `filePaths` before `project.addSourceFilesAtPaths(filePaths)` prevented `ts-morph` from resolving local relative modules (`./A2uiSurface`, `./adapter`), causing `getModuleSpecifierSourceFile()` to return `undefined` and leaving wildcard exports untransformed. Updated `refactor.cjs` to load all workspace files into the project before filtering the processing loop by `targetFile`.
  - **`ENOBUFS` in `refactor.cjs`**: `execSync` running `find` on `process.cwd() + '/..'` traversed all sibling worktrees in `.bare/`, exceeding Node's default 1MB `maxBuffer`. Resolved by setting `repoRoot` to the worktree and adding `{ maxBuffer: 50 * 1024 * 1024 }`.
  - **No Duplicate Exports**: All 25 exported symbols across `./A2uiSurface`, `./adapter`, and `./catalog/basic` are completely distinct; no collisions or duplicate exports occurred.
  - **Verification**: Ran Prettier formatting, `yarn workspace @a2ui/react run typecheck`, `yarn workspace @a2ui/react run format:check`, and `yarn workspace @a2ui/react run lint`, all passing cleanly with 0 errors.

## `renderers/react/src/v0_9/catalog/basic/index.ts`
- **Refactoring Status**: Successfully verified explicit named exports for `MarkdownContext` and `useMarkdownRenderer` re-exported from `./context/MarkdownContext` alongside `basicCatalog` and all 18 component definitions (`Text`, `Image`, `Icon`, etc.). No remaining wildcard (`export *`) exports exist in the file.
- **Edge Cases & Findings**:
  - **No Duplicate Exports**: All 21 exported symbols are unique; no duplicate exports or name collisions were encountered.
  - **API Surface Verification**: Verified 100% equivalence before and after refactoring across all 21 exported symbols (`AudioPlayer`, `Button`, `Card`, `CheckBox`, `ChoicePicker`, `Column`, `DateTimeInput`, `Divider`, `Icon`, `Image`, `List`, `MarkdownContext`, `Modal`, `Row`, `Slider`, `Tabs`, `Text`, `TextField`, `Video`, `basicCatalog`, `useMarkdownRenderer`).
  - **`ENOBUFS` in `refactor.cjs`**: Encountered `spawnSync /bin/sh ENOBUFS` on initial run when `execSync` ran `find` on `process.cwd() + '/..'` traversing all sibling worktrees in `.bare/` without an expanded `maxBuffer`. Resolved by configuring `{ maxBuffer: 50 * 1024 * 1024 }` in `refactor.cjs`.

