---
feature_name: catalog_document_representation
module_blueprints:
  - a2ui_core
  - a2ui_agent
  - a2ui_framework_adapter
dependencies: []
date_added: 2026-11-27
---

# Catalog document representation feature blueprint

## Problem

A2UI SDKs currently treat JSON Schema (and host-language schema libraries such as Zod in TypeScript, `json_schema_builder` in Dart, and `swift-json-schema` in Swift) as both the authoring format and the runtime in-memory representation of a catalog. As a result, `GenericBinder`, `NodeResolver`, `ReferenceMap`, `PayloadValidator`, `Express`, `Elemental`, `Atom`, and `dart/a2ui_cli` each independently traverse raw JSON Schema or Zod ASTs to rediscover basic semantic facts (whether a parameter is dynamic, a child slot, an action, or checkable). In addition, emitting `inlineCatalogs` relies on smuggling `$ref` strings inside `description` fields (`REF:common_types.json#/$defs/...`).

This blueprint specifies a canonical, JSON-Schema-free in-memory catalog model and a matching serializable **Catalog Document format** ([`catalog_schema.json`](../../specification/proposals/catalog_schema/catalog_schema.json)), isolating JSON Schema and third-party schema libraries behind compatibility adapters with zero breaking changes to existing public APIs.

---

## Core architecture

```text
  Catalog Document JSON ──> [CatalogDocumentCodec] ──┐
  Native SDK Builder API ────────────────────────────┼──> Canonical In-Memory CatalogModel
  Legacy JSON Schema doc ──> [JsonSchemaCodec] ──────┤      ├── ComponentDefinition
  Legacy Zod / Schema obj -> [LegacyAdapter] ────────┘      ├── FunctionDefinition
                                                            └── ParameterDefinition / TypeDefinition
                                                                     │
          ┌──────────────────────────────────────────────────────────┼──────────────────────────┐
          ▼                          ▼                               ▼                          ▼
  GenericBinder &           Direct PayloadValidator &      Express / Elemental /      dart/a2ui_cli
  NodeResolver &            ReferenceMap (O(1)/linear      Atom Compilers,            Analyzer & Linter
  DataContext               tree walk, no AST scraping)    Decompilers & Prompts      (no schema scraping)
                                                                     │
                                                                     ▼ (on demand)
                                                           [JsonSchemaCodec.toJsonSchema]
                                                           (Direct JSON prompts, wire compat,
                                                            inlineCatalogs, external interop)
```

---

## Requirements

### 1. Canonical in-memory model (`a2ui_core`)

Every Core SDK MUST define an immutable, strongly typed, JSON-Schema-free in-memory catalog model with direct 1:1 correspondence to [`catalog_schema.json`](../../specification/proposals/catalog_schema/catalog_schema.json):

1. **`CatalogModel`** (carried by or backing `Catalog`):
   - `catalogId: string`
   - `protocolVersion?: ProtocolVersion` (optional for pre-1.0 compatibility; fail-closed for v1.0+ surfaces)
   - `title?: string`, `description?: string`, `instructions?: string`
   - `metadata?: A2uiMetadata` (`{ extensions?: Record<Uax31Id, unknown> }`)
   - `types: ReadonlyMap<string, TypeDefinition>` (catalog-local leaf `DataType` definitions)
   - `surfaceProperties?: SurfacePropertiesDefinition` (maps to v0.9 `theme`)
   - `components: readonly ComponentDefinition[]` (ordered, plus O(1) name lookup)
   - `functions: readonly FunctionDefinition[]` (ordered, plus O(1) name lookup)
2. **`ComponentDefinition`**:
   - `name: string` (UAX #31 identifier, never `"Surface"`)
   - `description?: string`
   - `checkable: boolean` (default `false`)
   - `parameters: readonly ParameterDefinition[]` (ordered; declared component parameters only — never wire envelope keys unless explicitly declared as custom component properties)
   - `atLeastOneOf?: readonly (readonly string[])[]`
   - `allowedParents?: readonly string[]`, `allowedChildren?: readonly string[]`
   - `metadata?: A2uiMetadata`
   - `deprecated?: boolean`, `deprecatedReason?: string`
3. **`FunctionDefinition`**:
   - `name: string` (UAX #31 identifier, never `@`-prefixed)
   - `description?: string`
   - `returnType: FunctionReturnDefinition` (shorthand `string | number | integer | boolean | array | object | validationResult | any | void` or full `TypeDefinition`)
   - `allowedCallers: 'rendererOnly' | 'agentOnly' | 'rendererOrAgent'` (default `'rendererOnly'`)
   - `requiresUserActivation: boolean` (default `false`; if `true`, `allowedCallers` MUST be `'rendererOnly'`)
   - `parameters: readonly ParameterDefinition[]` (ordered; restricted to data types)
   - `atLeastOneOf?: readonly (readonly string[])[]`
   - `additionalParameters: boolean | TypeDefinition` (default `false`)
   - `deprecated?: boolean`, `deprecatedReason?: string`
4. **`ParameterDefinition` and `TypeDefinition`**:
   - `ParameterDefinition` pairs `name: string`, `required: boolean` (default `false`), and a `TypeDefinition`.
   - `TypeDefinition` is a closed discriminated union covering:
     - **Data types:** `string` (`dynamic`, `format`, `pattern`, `minLength`, `maxLength`, `default`), `number` (`dynamic`, `min`, `max`, `default`), `integer` (`dynamic`, `min`, `max`, `default`), `boolean` (`dynamic`, `default`), `enum` (`values`, `valueType`, `dynamic`, `default`), `const` (`value`), `any` (`dynamic`, `nullable`, `default`), `object` (`dynamic`, `properties`, `additionalProperties`, `atLeastOneOf`, `default`), `array` (`dynamic`, `items`, `minItems`, `maxItems`, `uniqueItems`, `default`), `union` (`variants`, `exclusive`, `dynamic`, `default`), `dataBinding`, `functionCall`, and `ref` (local `types` lookup).
     - **Component-only types:** `child`, `childList`, `action`, `checkRule`, `accessibility`.
     - **Internal legacy escape hatch (in-memory only, never emitted to Catalog Documents):** `rawJsonSchema` to preserve exotic legacy JSON Schema keywords (such as `patternProperties` or arbitrary `not`) without breaking existing callers.

### 2. Zero-dependency authoring API

Every Core SDK and Framework Adapter MUST allow developers to define components, functions, and catalogs directly using the canonical in-memory model **without importing Zod, `json_schema_builder`, `JSONSchema`, or writing JSON Schema fragments**:

1. `ComponentApi` and `FunctionApi` MUST support construction from a `ComponentDefinition` / `FunctionDefinition` (or ergonomic typed parameter builders) alongside existing legacy `schema` constructors.
2. In TypeScript (`@a2ui/web_core`), the parameter builder API SHOULD preserve literal parameter names, requiredness, enum values, and type kinds so framework adapters (`@a2ui/react`, `@a2ui/angular`) infer exact compile-time resolved prop types without `z.infer` or hardcoded property-name heuristics.

### 3. Bidirectional codecs and format auto-detection

1. **Catalog Document codec (`fromDocument` / `toDocument`):** Parses and serializes Catalog Documents conforming to [`catalog_schema.json`](../../specification/proposals/catalog_schema/catalog_schema.json). Validates `formatVersion === "1.0"`, UAX #31 identifiers, `"Surface"` reservation, `requiresUserActivation` vs. `allowedCallers`, unique names, and resolution of local `ref` names against `types`.
2. **JSON Schema codec (`fromJsonSchema` / `toJsonSchema`):**
   - Translates v0.9, v0.9.1, and v1.0 JSON Schema catalog documents into the canonical `CatalogModel` (and back to unbundled or bundled JSON Schema on demand).
   - Preserves an optional opaque legacy source attachment for JSON-Schema-loaded catalogs so `Catalog.fromJson(legacyDoc).toJson()` remains structurally identical to `legacyDoc` (preserving `conformance/core/catalog.yaml` round-trip guarantees).
   - Eliminates the need for `REF:` description-string smuggling on all catalogs authored via the canonical model or Catalog Document format.
3. **Auto-detection in `Catalog.fromJson(doc)`:** If `doc` carries `"formatVersion"`, `Catalog.fromJson` delegates to the Catalog Document codec; otherwise it delegates to the JSON Schema codec.

### 4. Backward compatibility (non-breaking transition)

1. All existing public APIs (`ComponentApi(name, schema)`, `FunctionApi(name, schema, returnType)`, `Catalog.fromJson`, `Catalog.toJson`, `Catalog.validationSchema`, `GenericBinder(context, schema)`, framework `ComponentImplementation` constructors, and `CommonSchemas` / Zod `*Schema` exports) MUST continue to work with zero breaking changes.
2. Legacy constructors convert their input (`ZodTypeAny`, `json_schema_builder.Schema`, `JSONSchema.Schema`, Pydantic `BaseModel`, or raw JSON Schema dict) into a canonical `ComponentDefinition` / `FunctionDefinition` lazily or at registration time, while lazily synthesizing legacy `.schema` views on demand for canonical definitions.

### 5. Web Core Zod decoupling (`@a2ui/web_core`)

To enable moving Zod support to an optional `@a2ui/zod` package in a future major version without rewriting core:

1. All Zod and `zod-to-json-schema` usage inside `@a2ui/web_core` MUST be isolated behind a dedicated compatibility module (`src/compat/zod/`, exported as `@a2ui/web_core/zod`) with a strict one-way dependency (`compat/zod -> core`; core modules MUST NOT import `zod` or `zod-to-json-schema`).
2. Protocol wire-message validation (non-catalog Zod usage for v0.9 and v1.0 envelopes, `AccessibilityAttributes`, `@metadata`, and `RendererCapabilities`) MUST use hand-written zero-dependency TypeScript validators instead of Zod (no lightweight third-party TS validation library is available in Google3, and hand-written validators eliminate Closure Compiler extern issues and reduce bundle size).
3. Root entrypoints continue registering the Zod compatibility adapter automatically so existing Zod-based callers work unchanged, while consumers using the canonical catalog API and core subpaths import zero Zod.

### 6. Subsystem simplification requirements

Once a `Catalog` exposes its canonical `CatalogModel`, downstream subsystems MUST consume the canonical model directly instead of scraping JSON Schema or Zod ASTs:

1. **Generic Binder (`GenericBinder`):** Maps `ParameterDefinition` directly to `BehaviorNode` (`child`/`childList` -> `STRUCTURAL`, `action` -> `ACTION`, `dynamic: true` -> `DYNAMIC`, `object`/`array` -> recursive `OBJECT`/`ARRAY`, `checkable: true` -> `CHECKABLE`, otherwise `STATIC`). No `$ref`, `REF:`, or Zod AST scraping on the canonical path.
2. **Child Reference Map (`ReferenceMap` / `GraphTopologyValidator`):** Extracts `single`, `list`, and `nested` child reference paths via a single recursive walk over `ComponentDefinition.parameters`.
3. **Component Envelope Mixins:** Determines custom vs. protocol envelope keys directly from `ComponentDefinition.parameters` and `ComponentDefinition.checkable`.
4. **Payload Validation (`PayloadValidator` & `DataContext`):** Validates component properties, function arguments (including `atLeastOneOf`, bounds, formats, `ValidationResult` coercion in `DynamicBoolean` positions, and post-validation default filling), and surface properties directly against `TypeDefinition`, falling back to legacy JSON Schema validators only when a `rawJsonSchema` escape-hatch node is present.
5. **Agent Inference Formats (`Express`, `Elemental`, `Atom`):** Query `ComponentDefinition` and `FunctionDefinition` directly (`param.dynamic`, `param.type`, `component.checkable`, `function.allowedCallers`) without calling `catalog.toJson()` or `inlineLocalRefs()`. `DirectJsonPromptGenerator` uses `JsonSchemaCodec.toJsonSchema` on demand when generating JSON Schema prompts.
6. **CLI Code Generation and Linting (`dart/a2ui_cli`):** `CatalogAnalyzer` reads `CatalogModel` directly without reverse-engineering `$ref`, `REF:`, `allOf`, `oneOf`, or `isCheckable` heuristics, and `lintCatalog` accepts both Catalog Documents and legacy JSON Schema documents.

---

## Relationship to existing module blueprints

This feature blueprint specifies the transition path for:

- [`a2ui_core.blueprint.md`](../modules/a2ui_core.blueprint.md) (§3.A Catalog Layer, §3.B Inline Catalog Generation, §3.C Validation Layer, §3.F `GenericBinder`).
- [`a2ui_agent.blueprint.md`](../modules/a2ui_agent.blueprint.md) (§3.A Catalog Representation, §3.B PromptGenerator, §4 Inference Formats).
- [`a2ui_framework_adapter.blueprint.md`](../modules/a2ui_framework_adapter.blueprint.md) (§4.2 `ComponentImplementation` authoring and TypeScript prop inference).
- [`node_resolution.blueprint.md`](node_resolution.blueprint.md) (§3–§6 schema-driven bindings, children, actions, and checks).
- [`typesafe_builder_api.blueprint.md`](typesafe_builder_api.blueprint.md) (Part 3 `dart/a2ui_cli` catalog analysis).
