---
name: migration
description: >-
  Migrates an app, renderer, catalog or agent that uses A2UI (or a predecessor
  such as Flutter `genui`) to a newer SDK or protocol version. Use when a task
  mentions migrating, upgrading, porting or moving A2UI code between SDKs,
  packages or protocol versions (v0.8, v0.9, v0.9.1, v1.0), when a dependency
  such as `genui`, `a2ui_core`, `@a2ui/web_core`, `a2ui-core` or an A2UI Swift
  package needs a major bump, or when payloads or fixtures must change wire
  version. The skill first identifies the language, the source and the target,
  then routes to a case-specific guide where one exists.
---

# A2UI migration

This skill is a router. It identifies what is being migrated and then sends
you to the guide for that case. A case is identified by three facts:

1. **Language / platform**: Dart (Flutter), TypeScript (Lit, Angular, React,
   web core), Python (agent SDKs, ADK, A2A), Swift, Kotlin.
2. **Source**: the SDK or package the code uses today and its version, and
   the protocol version it speaks on the wire.
3. **Target**: the SDK the code should use afterwards, and the protocol
   version it should speak.

Do not start editing before all three are written down. A migration that
changes the SDK and the wire version at the same time is two migrations;
split it when the agent and the renderer are not released together.

## Step 1: identify the language and the source SDK

Read the manifests in the repository, not just the file extensions:

| Manifest                                         | Dependency names to look for                                                                                          |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `pubspec.yaml`, Bazel `BUILD` with `dart_*`      | `genui`, `a2ui_core`, `a2ui_flutter`, `a2ui_agent`, `a2ui_cli`, `genai_primitives`                                    |
| `package.json`                                   | `@a2ui/web_core`, `@a2ui/lit`, `@a2ui/angular`, `@a2ui/react`, `@a2ui/markdown-it`, `@a2ui/agent`, `@a2ui/catalog-*`  |
| `pyproject.toml`, `requirements*.txt`, `uv.lock` | `a2ui-core`, `a2ui-agent-sdk`, `a2ui-a2a`, `a2ui-adk`, `a2ui-catalog-*`                                               |
| `Package.swift`                                  | `A2UISwiftCore`, `A2UISwiftUI`, `BasicCatalog`, `BasicCatalogSwiftUI` (products of this repository's `Package.swift`) |
| `build.gradle*`                                  | the legacy Kotlin agent SDK under `kotlin/agent_sdk_legacy/`                                                          |

Record the exact version constraint, and read that package's `CHANGELOG.md`
in this repository for the release line the code is on.

## Step 2: identify the wire protocol version

The SDK version does not always tell the protocol version; read the payloads
the code sends or expects (fixtures, goldens, prompts, transport code):

| Evidence in payloads                                                                                                                                       | Protocol |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `beginRendering`, `surfaceUpdate`, `dataModelUpdate` messages                                                                                              | v0.8     |
| `"version": "v0.9"` with `createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`; bindings as `{"path": ...}` and calls as `{"call": ...}` | v0.9     |
| `"version": "v0.9.1"`                                                                                                                                      | v0.9.1   |
| `"version": "1.0"`; bindings as `{"@path": ...}`, calls as `{"@call": ...}`; per-component `catalogId`; `callRendererFunction` / `callAgentFunction`       | v1.0     |

Other signs: catalog ids (`.../specification/v0_9/catalogs/basic/catalog.json`
is v0.9, `.../v1_0/...` is v1.0), the metadata keys for capabilities
(`a2uiClientCapabilities` is v0.9, `a2uiRendererCapabilities` is v1.0), and
the names of the schema directories a project validates against
(`specification/v0_9/json` versus `specification/v1_0/json`).

## Step 3: fix the target

Ask, or infer from the task, whether the target is a new SDK on the same
protocol version, a new protocol version on the same SDK, or both. When the
task does not say, prefer the smallest step: the current SDK's latest release
on the protocol version the agent already speaks. Record the target the same
way as the source.

## Step 4: route to a case guide

| Language | From                            | To                                                          | Guide                                                                                                                                                                                                                                                                                                                                    |
| -------- | ------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dart     | `package:genui` 0.x (A2UI v0.9) | `a2ui_core` + `a2ui_flutter` (+ `a2ui_agent`), v0.9 or v1.0 | [`dart-genui-to-a2ui_1_0/INDEX.md`](dart-genui-to-a2ui_1_0/INDEX.md)                                                                                                                                                                                                                                                                     |
| any      | protocol v0.8                   | protocol v0.9                                               | [`specification/v0_9/docs/evolution_guide.md`](../../../specification/v0_9/docs/evolution_guide.md); Python payload converter [`samples/agent/adk/migrate_v08_to_v09.py`](../../../samples/agent/adk/migrate_v08_to_v09.py); Lit renderer example in [`typescript/renderers/lit/README.md`](../../../typescript/renderers/lit/README.md) |
| any      | protocol v0.9                   | protocol v0.9.1                                             | [`specification/v0_9_1/docs/evolution_guide.md`](../../../specification/v0_9_1/docs/evolution_guide.md)                                                                                                                                                                                                                                  |
| any      | protocol v0.9 / v0.9.1          | protocol v1.0                                               | [`specification/v1_0/docs/evolution_guide.md`](../../../specification/v1_0/docs/evolution_guide.md), then the SDK's `CHANGELOG.md`                                                                                                                                                                                                       |
| any      | an A2UI SDK release             | a later release of the same SDK                             | that package's `CHANGELOG.md` (`Breaking:` entries first), then the generic procedure below                                                                                                                                                                                                                                              |

When a row matches, read the guide in full and follow it. When no row
matches, follow the generic procedure and then add a case (see the end of
this file).

## Generic procedure

Use this when no case guide exists, and as the outer loop around a case
guide:

1. **Inventory.** List every file that imports or depends on the source SDK,
   every fixture or golden that holds payloads, and every prompt that
   describes the wire format to a model. Group them by the layer they touch:
   transport, renderer wiring, catalogs and components, functions, tests.
2. **Dependencies first.** Change the manifest, then make the project resolve
   dependencies. Do not edit source until the new packages are installed.
3. **One layer at a time.** Migrate transport, then renderer wiring, then
   catalogs and components, then functions, then tests. Compile after each
   layer; a layer that does not compile hides errors in the next one.
4. **Payloads and prompts.** Update fixtures, goldens and prompt text to the
   target wire version. Do not blanket-replace keys; the evolution guides
   list which positions change.
5. **Behavioral differences.** Read the target's behavior notes (a case guide
   has a section for them) and check each one against the app: error
   handling, validation strictness, unknown ids, ordering, markdown, theming.
6. **Verify.** Run the analyzer or type checker, unit and widget tests, and
   one manual round trip against the real agent with a surface that has an
   input and an action.
7. **Record.** Note in the change description which case was applied, which
   behavioral differences needed app changes, and anything the guide did not
   cover.

## Adding a case

When you migrate something this skill has no guide for, add one so the next
migration starts from it:

1. Create `<language>-<from>-to-<to>/INDEX.md` next to this file, named
   like `dart-genui-to-a2ui_1_0`.
2. Give it the same sections as the existing guide: scope and version
   assumptions, dependencies, a step per layer with before/after code,
   behavioral differences, tests, a checklist.
3. Put long tables in sibling files (`api-mapping.md`, `recipes.md`,
   `behavior-changes.md`) and link them from `INDEX.md`.
4. Add a row to the table in Step 4.
5. Follow [`natural-writing`](../natural-writing/SKILL.md) and
   [`pr-hygiene`](../pr-hygiene/SKILL.md) for the text and the pull request.
