# Decoupling A2UI catalogs from JSON Schema: engineering analysis and complexity cost

## Problem

A2UI currently uses JSON Schema Draft 2020-12 as both the on-disk catalog specification format and (via Zod, `json_schema_builder`, `swift-json-schema`, and raw Python dicts) the in-memory runtime model across all four SDKs. That coupling has produced thousands of lines of duplicated AST scraping across `GenericBinder`, `NodeResolver`, `ReferenceMap`, `PayloadValidator`, `Express`/`Elemental`/`Atom`, and `dart/a2ui_cli`, plus Google3 Closure Compiler and bundle-size pain from Zod and `zod-to-json-schema`.

Before committing to a repository-wide migration, we built, adversarially reviewed, and refined full working prototypes across the specification, blueprints, and every active SDK in the monorepo:

1. Specification, worked examples, and blueprints: [PR #4427](https://github.com/a2ui-project/a2ui/pull/4427)
2. TypeScript and Web (`@a2ui/web_core`, `@a2ui/agent`, `@a2ui/react`, `@a2ui/angular`, `@a2ui/lit`): [PR #4431](https://github.com/a2ui-project/a2ui/pull/4431)
3. Python (`a2ui_core`, `a2ui_agent`, `tools/build_catalog`): [PR #4432](https://github.com/a2ui-project/a2ui/pull/4432)
4. Dart, Flutter, and CLI (`a2ui_core`, `a2ui_agent`, `a2ui_cli`, `a2ui_flutter`): [PR #4430](https://github.com/a2ui-project/a2ui/pull/4430)
5. Swift and SwiftUI (`A2UICore`, `A2UISwiftUI`): [PR #4429](https://github.com/a2ui-project/a2ui/pull/4429)

This document evaluates whether the change is a net improvement, quantifies the real complexity cost observed during implementation, and recommends a staged adoption path.

---

## Executive verdict

**Adopt the in-memory `CatalogModel` and Web Core Zod decoupling unconditionally. Adopt the on-disk Catalog Document format conditionally, gated by a shared conformance suite and clear deprecation milestones for legacy JSON Schema catalogs.**

Building all four language prototypes revealed a sharp asymmetry between the two halves of the proposal:

1. **The in-memory `CatalogModel` (plus zero-Zod Web Core) pays back immediately.** It eliminates 5 to 7 duplicated AST scrapers per language, removes `zod` and discouraged `zod-to-json-schema` from `@a2ui/web_core` core and `@a2ui/agent`, drops `jsonschema` from `a2ui-agent-sdk` runtime dependencies, removes `json_schema_builder` and `JSONSchema` imports from custom Flutter and SwiftUI component authoring, simplifies `GenericBinder` and `dart/a2ui_cli`, and solves most of the core architecture requirements for Protobuf transport.
2. **Dual-format backward compatibility carries a real, measurable transition tax.** While both JSON Schema and Catalog Documents coexist with zero breaking changes, the four SDKs carry ~36,000 lines of new model, codec, and native validator production code alongside the retained legacy JSON Schema machinery. Writing four independent native validators and codecs also re-introduces subtle edge-case drift across languages (our adversarial reviews independently caught almost identical bugs in all four PRs).

The change is a clear long-term improvement **if and only if** the team treats the dual-format compatibility layer as temporary, backs the new codecs and validators with a shared conformance suite (`conformance/core/catalog_document.yaml`), and plans to extract or retire legacy JSON Schema / Zod adapters in a future major version.

---

## Measured prototype metrics

### Line counts across the four SDK prototypes (post-Refinement Pass 1)

| Language / PR                                                                         | Files changed | Total diff (`+` / `-`) |                                                            New model + codecs + validator prod LOC                                                             | New test LOC |                                 Existing files modified (`+` / `-`)                                  | Key deletions & bypasses achieved                                                                                                                                                                                           |
| :------------------------------------------------------------------------------------ | :-----------: | :--------------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------: | :----------: | :--------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **TypeScript** ([PR #4431](https://github.com/a2ui-project/a2ui/pull/4431))           |      90       |    +13,426 / -2,122    |                                           5,924 (`catalog/model/`) + 620 (`wire-validators`) + 1,643 (`compat/zod`)                                            |    ~2,600    |              -107 net on 43 tracked files (pre-Pass 1; zero diff on pre-existing tests)              | `generic-binder.ts` -836 LOC; `payload-validator.ts` -263 LOC; `data-context.ts` -72 LOC; 3,575 LOC of Zod AST scrapers bypassed by 455 LOC `model_semantics.ts`; 0 runtime Zod in core & `@a2ui/agent`                     |
| **Python** ([PR #4432](https://github.com/a2ui-project/a2ui/pull/4432))               |      41       |     +11,879 / -995     |                                6,229 (`model`, `document_codec`, `json_schema_adapter`, `pydantic_adapter`, `model_validator`)                                 |    2,210     |                         `a2ui_agent/src`: +1,600 / -890 (-525 net in Pass 1)                         | `CatalogSchemaHelper` unified on `CatalogModel`; parallel Express/Elemental/Atom crawlers deleted; `jsonschema` dropped from `a2ui-agent-sdk` runtime deps                                                                  |
| **Dart / Flutter / CLI** ([PR #4430](https://github.com/a2ui-project/a2ui/pull/4430)) |      32       |     ~+9,800 / -700     | 6,285 (`type_definition`, `catalog_model`, `catalog_document_codec`, `json_schema_codec`, `canonical_validator`, `json_utils`) + 106 (`catalog_document_lint`) |    1,381     | `catalog_analyzer.dart` 685 -> 607 (-78 net, eliminating all `$ref`/`REF:`/`allOf`/`oneOf` scraping) | `catalog_document_lint.dart` 727 -> 106 (-85%) via shared codec diagnostics; `a2ui_flutter` custom widgets need zero `json_schema_builder`; `a2ui` CLI compiles standalone native exe                                       |
| **Swift / SwiftUI** ([PR #4429](https://github.com/a2ui-project/a2ui/pull/4429))      |      30       |    +9,986 / -1,462     |                                                    6,836 (`Model/*.swift`, codecs, `ModelPayloadValidator`)                                                    |    1,584     |                         +104 net across 15 modified files (+1,566 / -1,462)                          | **All 5 legacy runtime AST walkers deleted** (`CatalogConformanceTests` -264, `DataContext` -166 & dropped `import JSONSchema`, `ComponentEnvelope` -153, `PayloadValidator` -93, `NodeResolver` dropped `import A2UIJSON`) |

### Authoring size reduction on published v1.0 catalogs

| Published catalog                       | Legacy JSON Schema `catalog.json` | Catalog Document `*.catalog.json` | Line reduction |
| :-------------------------------------- | :-------------------------------: | :-------------------------------: | :------------: |
| Basic Catalog v1.0 (`basic/v1`)         |            1,206 lines            |             498 lines             |    **-59%**    |
| MCP Catalog v1.0 (`mcp/v1`)             |             282 lines             |             238 lines             |    **-16%**    |
| VegaChart Catalog v1.0 (`vegachart/v1`) |             43 lines              |             26 lines              |    **-40%**    |

All four published catalogs (`basic/v1`, `basic/v0_9`, `mcp/v1`, `vegachart/v1`) round-tripped through `fromJson -> toDocument -> fromDocument -> toJsonSchema` with **zero `rawJsonSchema` fallback nodes** across TypeScript, Python, Dart, and Swift.

---

## Where the architecture delivers concrete wins

### 1. Decoupling Zod from Web Core and fixing Google3 friction

Scanning Google3 (`//third_party/javascript/` and `//third_party/javascript/node_modules/`) showed that **no lightweight TypeScript validation library exists in Google3 today** (`valibot`, `@sinclair/typebox`, `arktype`, `superstruct`, `io-ts`, `yup`, `runtypes`, `effect`, and `valita` are all absent). Google3 has only `//third_party/javascript/colinhacks_zod` (Zod v3.25.76 only; v4 is stripped by `copy.bara.sky`, ~26.7 KB gzip, restricted `package_users` visibility) and `//third_party/javascript/zod_to_json_schema` (marked `discouraged: UNMAINTAINED_UPSTREAM`). Furthermore, `//third_party/a2ui` currently carries a 190-line Closure externs patch (`b/574182320`) and `colinhacks_zod` needed an emergency Closure enum patch (`b/579495166`) after property renaming silently disabled validation.

Replacing non-catalog Zod validation in `@a2ui/web_core` with hand-written, zero-dependency, Closure-safe TypeScript wire validators took **620 lines** (`wire-validators.ts`) for all v0.9 and v1.0 protocol messages. Isolating legacy Zod support into `@a2ui/web_core/zod` (`src/compat/zod/`, 1,643 LOC) proved via transitive import-graph testing (`zod_boundary.test.ts`) that `@a2ui/web_core/catalog/model`, `wire-validators.ts`, `MessageProcessor`, `PayloadValidator`, `NodeResolver`, `GenericBinder`, `DataContext`, and all of `@a2ui/agent/src/` have **zero transitive runtime dependency on `zod` or `zod-to-json-schema`**. When `@a2ui/web_core/zod` is extracted to an optional `@a2ui/zod` package in a future major version, core web bundles save ~18 to 20 KB min+gzip and drop the Closure externs burden completely.

### 2. Eliminating duplicated AST scraping across core and agent subsystems

Before this prototype, every semantic question about a component property ("Is it dynamic?", "Is it a child slot?", "Is it an action?", "Is this component checkable?") was re-derived by walking JSON Schema or Zod ASTs in 5 to 7 places per SDK:

1. **TypeScript `GenericBinder` and child-ref extraction:** `generic-binder.ts` shrank from 1,937 to 1,101 lines (-836 LOC). On canonical catalogs, 3,575 lines of Zod AST scrapers (`ref-fields.ts`, `reference-map.ts`, `zod_behavior_scraper.ts`, `zod_return_types.ts`, `zod_known_keys.ts`) are bypassed by 455 lines of direct switch statements (`model_semantics.ts`, an 87% reduction). Angular's `ComponentBinder` also stopped hardcoding `'children' | 'child' | 'trigger' | 'content'` and now reads `extractDefinitionRefFields(definition)`.
2. **Swift runtime walkers:** By precomputing `storedDefinition` once on `init` for both canonical and legacy `Schema`-backed APIs, PR #4429 **deleted all five legacy runtime JSON Schema AST walkers** (`ComponentEnvelope`, `GraphTopologyValidator`, `NodeResolver`, `DataContext`, and `PayloadValidator`), eliminating runtime `Schema(...)` AST rewriting and recompilation on every nullable local function call in `DataContext` while keeping macOS release scaling tests green.
3. **Python Agent SDK:** `CatalogSchemaHelper` now reads `CatalogModel` directly without calling `catalog.to_json()` followed by `inline_local_refs()` (which previously serialized Pydantic `BasicCatalog` to JSON Schema dicts only to parse them back). Express, Elemental, and Atom were verified with `catalog.to_json` monkeypatched to raise `AssertionError`. `a2ui-agent-sdk` dropped its unused `jsonschema` runtime dependency.
4. **Dart `a2ui_cli` catalog analyzer and linter:** `CatalogAnalyzer` replaced `$ref` suffix parsing, `REF:` description regexes, `allOf`/`oneOf` dynamic-branch stripping, and heuristic `isCheckable` detection with an exhaustive `switch` over sealed `TypeDefinition`. Doing so also exposed a real latent bug in the old JSON Schema analyzer: `DateTimeInput.min`/`max` (`allOf: [DynamicString, {if/then: oneOf formats}]`) had silently degraded to `Optional[Any]` in generated Python builders, whereas `CatalogModel` decoded it directly as `StringType(dynamic: true, formats: ['date', 'time', 'date-time'])`. Sharing diagnostic collection between `CatalogDocumentCodec` and `a2ui lint` shrank `catalog_document_lint.dart` from 727 to 106 lines (-85%).

### 3. Developer ergonomics for custom catalogs

Custom component authors no longer need to learn A2UI's restricted JSON Schema dialect or third-party schema library workarounds:

1. **TypeScript:** `defineComponent` + `a2uiType` builders provide compile-time resolved prop type inference (`ResolveDefinitionProps`) without `z.infer` or Zod in the bundle.
2. **Dart / Flutter:** `ComponentImplementation.define(...)` eliminates both the `json_schema_builder` runtime dependency in Flutter apps and the `hide ValidationResult` import collision documented in `dart/a2ui_flutter/README.md`.
3. **Swift / SwiftUI:** `ComponentImplementation(definition:builder:)` removes `import JSONSchema` and triple-quoted raw JSON Schema strings from SwiftUI apps.
4. **Python:** Frozen slotted dataclasses (`ComponentDefinition`, `ParameterDefinition`, `StringType(dynamic=True)`) replace raw JSON Schema dicts and `Annotated[..., JsonSchemaAs(...)]` boilerplate.

### 4. Foundation for Protobuf transport

Our follow-up investigation of the two Protobuf transport proposals (see `proto_transport_analysis.md`) showed that `CatalogModel` eliminates roughly 85% of the +4,689 LOC core refactor previously proposed for pluggable schema validators, while enabling bidirectional `CatalogModel` <-> `.proto` codegen and branded opaque host types (`SafeHtml` / `TrustedResourceUrl`) that remain reactive over `@path` data bindings.

---

## The real complexity cost (honest assessment)

Building and reviewing four full language implementations surfaced four concrete costs that would have been easy to underestimate on paper.

### 1. High dual-format transition LOC (~27k–32k new production LOC across 4 SDKs)

As long as A2UI maintains zero breaking changes alongside full legacy JSON Schema conformance (`fromJson(doc).toJson() == doc` and golden `validation_schema` files in `conformance/core/catalog.yaml`), every SDK must carry **four** distinct pieces of machinery simultaneously:

1. The canonical in-memory `CatalogModel` (~700–1,600 LOC per SDK).
2. `CatalogDocumentCodec` (~1,150–1,800 LOC per SDK) for parsing, validating, and serializing Catalog Documents.
3. `JsonSchemaCodec` (~1,325–2,230 LOC per SDK) translating both directions between v0.9/v0.9.1/v1.0 JSON Schema and `CatalogModel`.
4. `ModelPayloadValidator` (~1,000–1,400 LOC per SDK) validating wire payloads directly against `CatalogModel`, while retaining `jsonschema`/`json_schema_builder`/`swift-json-schema`/`zod` for legacy `RawJsonSchemaType` escape hatches and existing public APIs.

In the short term, total codebase LOC **goes up** (~+45,000 lines across 4 PRs including tests) before it can go down. The large net deletion (~15,000–25,000 lines across the monorepo, including `@a2ui/web_core/scripts/` 3,480 LOC Zod codegen, `SpecShaper`, `schema_loader`, `schema_serializer`, `ref-fields`, `reference-map`, and legacy validators) only materializes in Phase 3, when legacy Zod/JSON Schema adapters are extracted to optional packages or deprecated.

### 2. Re-implementing schema validation semantics four times invites drift

The single strongest warning signal from our adversarial reviews was how consistently **the exact same 7 edge-case bugs appeared independently across all four SDKs** on the first implementation pass:

1. **Structural cyclic `ref`s (`A -> Object(Ref(A))`, `A -> Union([Ref(A), String])`):** All four first passes either rejected valid recursive types, stack-overflowed on structural traversal, silently skipped validation at depth >= 2, or produced false-positive union matches by returning 0 errors on a visited ref.
2. **Multi-group `atLeastOneOf` (`[['a', 'b'], ['c', 'd']]`):** Multiple SDKs flattened groups into a single `anyOf` (logical OR) instead of `allOf: [{anyOf: ...}, ...]` (logical AND of OR groups).
3. **Strict RFC 3339 date/time validation:** Native `Date.parse`, `DateTime.tryParse`, and Python `fromisoformat` silently rolled over invalid dates like `2024-02-31`, accepted `99:99:99`, or differed across Python 3.10 vs 3.12.
4. **Unicode code-point string lengths:** TypeScript (`value.length`) and Dart (`value.length`) initially counted UTF-16 code units rather than Unicode code points (`[...value].length` / `value.runes.length`), diverging from Python (`len`) and Swift (`unicodeScalars.count`).
5. **Explicit `null` on optional non-nullable keys and `EnumType` homogeneity/default checks:** Three of four parsers initially accepted explicit `null` values or mixed-type enums when `valueType` was omitted.
6. **v0.9 vs v1.0 codec quirks:** `allOf` mixin ordering (`CatalogComponentCommon.weight` jumping to parameter #0 and shifting Express positional arguments), v0.9 function `properties.returnType.const`, and `ObjectType` with `atLeastOneOf` or multi-format `StringType` colliding with generic `oneOf`/`anyOf` union detection.
7. **`toJson()` contract ambiguity:** Python initially returned a Catalog Document from `Catalog.from_document(doc).to_json()`, breaking `DirectJsonFormat` prompts until aligned with the cross-language rule that `toJson()` always emits JSON Schema and `toDocument()` emits Catalog Documents.

Replacing a battle-tested JSON Schema validator with four custom validators means **A2UI now owns those edge cases permanently**. Without a strict language-agnostic conformance suite (`conformance/core/catalog_document.yaml`), the four implementations will drift over time.

### 3. TypeScript compile-time prop inference complexity

In TypeScript, preserving compile-time prop inference for React and Angular without `z.infer` required 236 lines of advanced conditional mapped types (`infer_definition_props.ts`) plus carefully overloaded builder signatures (`A2uiTypeBuilders`) to stop TypeScript contextual typing from widening optional fields into giant unions. It works cleanly and fixes Angular's hardcoded `'child' | 'children'` hack, but it requires careful TypeScript maintenance and `tsc`-verified type tests whenever `TypeDefinition` changes.

### 4. Ecosystem interoperability still requires JSON Schema output

As raised in review comments on the original design doc, external tools (Direct JSON LLM prompts, Monaco editors, MCP `allowedFunctions`, SOBI) consume JSON Schema. Therefore `toJsonSchema()` is a **permanent** part of the architecture, not a throwaway migration shim. The good news from prototyping is that `CatalogModel -> JSON Schema` is far cleaner and more deterministic than `Zod -> JSON Schema` (no `SpecShaper` 8-level disjointness prover, no `spec()` `WeakMap` annotations, no `REF:` description smuggling).

---

## Strategic options compared

| Option                                                                                                      | What ships                                                                                                                                                                                                      | Net engineering cost                                                                                                                                   | Key wins delivered                                                                                                                                                              | Key downsides                                                                                                                                 |
| :---------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Status quo**                                                                                           | Keep JSON Schema & Zod as canonical representation                                                                                                                                                              | Zero upfront; high ongoing drag                                                                                                                        | Zero migration churn                                                                                                                                                            | Retains 5–7 AST scrapers/SDK, Zod Closure patches in Google3, `REF:` hacks, poor custom catalog DX, blocks clean Proto transport              |
| **2. In-memory `CatalogModel` + Zero-Zod Web Core ONLY** (keep JSON Schema as the only on-disk file format) | Ship `CatalogModel`, `ModelPayloadValidator`, `JsonSchemaCodec`, zero-Zod `@a2ui/web_core` & `@a2ui/agent`, simplified `GenericBinder` & `a2ui_cli`, native SDK builders. Defer `Catalog Document` JSON format. | **Medium** (~30% less new code than Option 3: drops `CatalogDocumentCodec` & `catalog_document_lint` across 4 SDKs; zero author migration)             | Delivers **~90% of SDK simplification**, **100% of Zod decoupling**, **100% of custom-catalog DX**, and **100% of Proto transport synergy**                                     | Authors writing standalone JSON catalog files still write v1.0 JSON Schema boilerplate (though `build_catalog` or SDK builders mitigate this) |
| **3. Full `CatalogModel` + `Catalog Document` format** (as prototyped in PRs `#4427`–`#4432`)               | Everything in Option 2, plus `catalog_schema.json`, `fromDocument`/`toDocument`, `a2ui_cli` & `build_catalog` Catalog Document support                                                                          | **High during transition** (+~36k prod LOC across 4 SDKs until Phase 3 cleanup); **lowest steady-state complexity** once legacy JSON Schema is retired | Everything in Option 2, plus **59% smaller** human/LLM-authored catalog files, structural ban on external `$ref`s, and 1:1 wire-to-memory parity for v1.x/v2.0 `inlineCatalogs` | Maintains two on-disk catalog formats and 4 codecs until legacy JSON Schema is deprecated; requires `conformance/core/catalog_document.yaml`  |

---

## Recommended phased rollout

1. **Immediate (Phase 1 — High-confidence, shippable now):**
   - Land the **in-memory `CatalogModel`**, **zero-dependency Web Core wire validators**, **isolated `@a2ui/web_core/zod` boundary**, **simplified `GenericBinder`/`NodeResolver`/`ReferenceMap`/`CatalogSchemaHelper`/`a2ui_cli`**, and **native zero-schema-library authoring APIs** across all four SDKs.
   - Author a shared **`conformance/core/catalog_model.yaml`** (and `catalog_document.yaml` if Phase 2 proceeds) covering all 7 edge-case categories uncovered in our adversarial reviews before merging to `main`.
2. **Short-term (Phase 2 — Validate with catalog authors):**
   - Test `specification/proposals/catalog_schema/catalog_schema.json` with teams actively authoring large shared catalogs (such as the Unified Material Catalog and Gemini Enterprise catalogs) using `tools/build_catalog --output-format catalog-document` / `json-schema`.
   - If catalog authors prefer writing Catalog Documents over v1.0 JSON Schema, adopt `formatVersion: "1.0"` as the primary authoring format and add it to the next protocol minor/major release for `inlineCatalogs`. If teams prefer keeping v1.0 JSON Schema files (or `.proto` files via reverse codegen), Option 2 already captures almost all SDK benefits without carrying four `CatalogDocumentCodec` implementations.
3. **Medium-term (Phase 3 — Realize the full LOC deletion):**
   - In the next major SDK release, move `@a2ui/web_core/zod` out into an optional `@a2ui/zod` package, remove `zod` and `zod-to-json-schema` from `@a2ui/web_core/package.json`, delete the 3,480-line Zod schema codegen scripts, and retire legacy runtime JSON Schema AST scrapers across TypeScript, Python, and Dart (matching what Swift PR #4429 already achieved).
