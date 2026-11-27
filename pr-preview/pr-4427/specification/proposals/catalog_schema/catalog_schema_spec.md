# A2UI Catalog Document format specification and authoring guide

**Status:** Proposal (targets A2UI v1.0 and backward-compatible v0.9/v0.9.1 catalogs)
**Meta-schema:** [`catalog_schema.json`](catalog_schema.json)

## Problem

A2UI currently defines catalogs as JSON Schema Draft 2020-12 documents governed by [`specification/v1_0/json/catalog_definition.json`](../../v1_0/json/catalog_definition.json). That design causes five recurring problems across the protocol, SDKs, and tooling:

1. **Dialect mismatch:** A2UI bans arbitrary external `$ref`s, component-root `oneOf`/`anyOf`, and component `$defs`, while catalog authors in large ecosystems naturally reach for general JSON Schema features that A2UI SDKs and DSL inference formats intentionally reject.
2. **Boilerplate that obscures the API:** Published catalog files spend 30% to 50% of their lines on JSON Schema wiring (`component: {"const": "..."}`, `@call: {"const": "..."}`, `allOf` wrapping `Checkable`, `$defs.anyComponent` with `discriminator`, `$defs.anyFunction`, `unevaluatedProperties: false`, and repeated `common_types.json#/$defs/...` pointers).
3. **Brittle round-tripping:** SDKs that let developers author catalogs in code (such as Zod in TypeScript or `json_schema_builder` in Dart) must smuggle `$ref` targets through `REF:common_types.json#/$defs/...` description strings and run multi-hundred-line schema shapers to emit spec-compliant JSON.
4. **Duplicated schema reverse-engineering:** Every subsystem that needs semantic information about a property (`GenericBinder`, `NodeResolver`, `ReferenceMap`, `PayloadValidator`, `Express`, `Elemental`, `Atom`, and `dart/a2ui_cli`) independently walks `$ref`, `$defs`, `allOf`, `oneOf`, and `anyOf` to rediscover whether a field is dynamic, static, a child reference, an action, or checkable.
5. **External reference confusion:** Using JSON Schema `$ref` alongside URI-shaped `catalogId` strings misleads readers into assuming A2UI fetches remote schemas over the network, which the SDKs intentionally forbid.

This specification defines a dedicated **A2UI Catalog Document format** governed by a strict JSON Schema meta-schema ([`catalog_schema.json`](catalog_schema.json)). Catalog documents are plain JSON data structures that directly describe A2UI components, functions, parameters, and local leaf types. JSON Schema becomes an implementation detail produced on demand by an adapter when needed (for Direct JSON prompts, wire validation, editor tooling, or external interop such as MCP).

---

## Design goals

1. **Lossless parity with v1.0 catalogs:** Every component, function, constraint, composition rule, extension map, and local leaf type in the published Basic, MCP, VegaChart, and conformance catalogs translates losslessly between the Catalog Document format and v1.0 JSON Schema.
2. **One canonical shape:** Collections have one representation (ordered arrays for `components`, `functions`, `parameters`, and `properties`), guaranteeing deterministic parameter ordering for positional inference formats such as Express and Atom, and exact round-tripping.
3. **1:1 mapping to in-memory SDK models:** Every field in the JSON document corresponds directly to a field on the canonical in-memory `CatalogModel` in TypeScript, Python, Dart, and Swift.
4. **Context-scoped type safety:** The meta-schema structurally prevents UI-only types (`child`, `childList`, `action`, `checkRule`, `accessibility`) from appearing inside function parameters, function return types, local `types`, or `surfaceProperties`.
5. **No network or cross-file references:** Local leaf type references use plain identifier names (`"type": "ref", "ref": "Weight"`), making remote `$ref` resolution impossible by construction.
6. **Unambiguous format detection:** Every Catalog Document carries `"formatVersion": "1.0"`, allowing SDK loaders (`Catalog.fromJson`) to auto-detect Catalog Documents versus legacy JSON Schema catalog files reliably.

---

## Document structure

A Catalog Document is a closed JSON object (`additionalProperties: false`).

| Field               | Type                           | Required | Default | Description                                                                                                                     |
| :------------------ | :----------------------------- | :------: | :-----: | :------------------------------------------------------------------------------------------------------------------------------ |
| `$schema`           | `string`                       |    No    |    —    | Optional URI pointing to `catalog_schema.json` for editor autocomplete and validation.                                          |
| `formatVersion`     | `"1.0"`                        | **Yes**  |    —    | Format discriminator. Must equal `"1.0"`.                                                                                       |
| `catalogId`         | `string` (`minLength: 1`)      | **Yes**  |    —    | Unique opaque identifier for the catalog. Never fetched over the network.                                                       |
| `protocolVersion`   | SemVer `string`                |    No    | `"1.0"` | A2UI protocol version targeted by this catalog (e.g., `"1.0"`, `"0.9"`, `"0.9.1"`).                                             |
| `title`             | `string`                       |    No    |    —    | Human-readable catalog title.                                                                                                   |
| `description`       | `string`                       |    No    |    —    | Human-readable catalog description.                                                                                             |
| `instructions`      | `string`                       |    No    |    —    | Markdown guidelines and examples included in LLM prompts.                                                                       |
| `metadata`          | `{ extensions?: Extensions }`  |    No    |    —    | Optional catalog-level static metadata. Extension keys must be UAX #31 identifiers (`a2ui_*` reserved for official extensions). |
| `types`             | `Record<Identifier, DataType>` |    No    |  `{}`   | Catalog-local reusable leaf data types (e.g., `Weight`, `ColorToken`, `SelectOption`).                                          |
| `surfaceProperties` | `SurfacePropertiesDefinition`  |    No    |    —    | Optional surface-level data properties. Maps to `theme` when targeting pre-1.0 JSON Schema catalogs.                            |
| `components`        | `ComponentDefinition[]`        |    No    |  `[]`   | Ordered list of component contracts.                                                                                            |
| `functions`         | `FunctionDefinition[]`         |    No    |  `[]`   | Ordered list of function contracts.                                                                                             |

### Identifier rules

Every component name, function name, parameter name, object property name, local type name, and metadata extension key MUST match Unicode UAX #31:

```regex
^[\p{XID_Start}_][\p{XID_Continue}]*$
```

Additional identifier invariants:

1. Component names MUST NOT equal `"Surface"` (reserved for the top-level surface container).
2. Function names cannot begin with `"@"` (already excluded by UAX #31; reserved for system functions such as `@index`).
3. Sibling names inside `components`, `functions`, `parameters`, and `properties` MUST be unique within their enclosing array.
4. Component `parameters` MUST NOT declare reserved wire-envelope keys `"id"` or `"component"`.

### Semantic validation invariants

Conformant parsers and linters MUST enforce the following invariants beyond raw JSON Schema structure:

1. **Local `ref` resolution and cycles:** Every `{"type": "ref", "ref": "<Name>"}` MUST resolve to a key in root `types`. Structural recursion guarded by an `object` or `array` boundary (for example, `TreeNode -> object { next?: ref("TreeNode") }` or `NestedList -> array<ref("NestedList")>`) is valid. Unguarded alias cycles (for example, `A -> ref("B") -> ref("A")`, or `A -> union([ref("A"), string])`) are invalid and MUST be rejected.
2. **Closed keys and explicit `null`:** Unknown properties and explicit `null` values on optional non-nullable fields MUST be rejected.
3. **Bounds and patterns:** `min <= max`, `minLength <= maxLength`, and `minItems <= maxItems` MUST hold whenever both endpoints are present. Numeric values (`min`, `max`, `default`, `const`) MUST be finite. `StringType.pattern` MUST be a valid regular expression.
4. **Enum homogeneity and defaults:** Every element of `EnumType.values` MUST match `valueType` (default `"string"`). When `default` is present on an `EnumType`, it MUST appear in `values`. On `AnyType`, `default: null` is valid only when `nullable: true`.
5. **Runtime constraint semantics:** `minLength` and `maxLength` count Unicode code points (scalar values), not UTF-16 code units. `date`, `time`, and `date-time` string formats follow strict RFC 3339 (valid calendar dates without rollover such as rejecting `2024-02-31`, mandatory timezone offset on `time` and `date-time`, accepting `T`/`t` and `Z`/`z`). `uri` requires an explicit RFC 3986 scheme prefix. `IntegerType` rejects booleans and accepts whole-number JSON numbers (such as `1` and `1.0`).

---

## Component definitions

Each entry in `components` describes one UI component. Protocol envelope properties (`id`, `component`, `@catalogId`, `@accessibility`, `@metadata`, `@checks`) are never listed in `parameters` unless the component intentionally declares a custom bare property with a colliding name (such as a custom `accessibility` or `metadata` field in v1.0).

| Field              | Type                           | Required | Default | Description                                                                                                            |
| :----------------- | :----------------------------- | :------: | :-----: | :--------------------------------------------------------------------------------------------------------------------- |
| `name`             | `Identifier` (not `"Surface"`) | **Yes**  |    —    | Component type name (e.g., `"Text"`, `"Button"`).                                                                      |
| `description`      | `string`                       |    No    |    —    | Usage guidance for developers and LLMs.                                                                                |
| `checkable`        | `boolean`                      |    No    | `false` | When `true`, the component accepts validation checks (`@checks` in v1.0, `checks` in v0.9).                            |
| `parameters`       | `ComponentParameter[]`         |    No    |  `[]`   | Ordered list of component parameters. Declaration order defines positional argument order in Express and Atom.         |
| `atLeastOneOf`     | `Identifier[][]`               |    No    |    —    | Cross-parameter requirement groups; each inner array requires at least one named parameter to be present.              |
| `allowedParents`   | `Identifier[]` (unique)        |    No    |    —    | Parent component names allowed to contain this component (`"Surface"` denotes surface root). Omit to allow any parent. |
| `allowedChildren`  | `Identifier[]` (unique)        |    No    |    —    | Child component names allowed inside this component. Omit to allow any child.                                          |
| `metadata`         | `{ extensions?: Extensions }`  |    No    |    —    | Static component-level metadata and extensions.                                                                        |
| `deprecated`       | `boolean`                      |    No    | `false` | Marks the component as deprecated.                                                                                     |
| `deprecatedReason` | `string`                       |    No    |    —    | Explanation and replacement guidance when `deprecated` is `true`.                                                      |

---

## Function definitions

Each entry in `functions` describes one catalog function (renderer-side, agent-side, or callable by both).

| Field                    | Type                                                 | Required |     Default      | Description                                                                                                                                                                                                                                             |
| :----------------------- | :--------------------------------------------------- | :------: | :--------------: | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`                   | `Identifier`                                         | **Yes**  |        —         | Function name (e.g., `"required"`, `"formatDate"`).                                                                                                                                                                                                     |
| `description`            | `string`                                             |    No    |        —         | Function behavior description for developers and LLMs.                                                                                                                                                                                                  |
| `returnType`             | `FunctionReturnType`                                 | **Yes**  |        —         | Shorthand type string (`"string"`, `"number"`, `"integer"`, `"boolean"`, `"array"`, `"object"`, `"validationResult"`, `"any"`, `"void"`), a `{ "type": "void" \| "validationResult", "description"?: string }` object, or a full `DataType` definition. |
| `allowedCallers`         | `"rendererOnly" \| "agentOnly" \| "rendererOrAgent"` |    No    | `"rendererOnly"` | Roles permitted to invoke the function.                                                                                                                                                                                                                 |
| `requiresUserActivation` | `boolean`                                            |    No    |     `false`      | When `true`, execution requires an active user gesture and `allowedCallers` MUST be `"rendererOnly"`.                                                                                                                                                   |
| `parameters`             | `DataParameter[]`                                    |    No    |       `[]`       | Ordered list of function arguments. Restricted strictly to `DataType` (no `child`, `childList`, `action`, `checkRule`, or `accessibility`).                                                                                                             |
| `atLeastOneOf`           | `Identifier[][]`                                     |    No    |        —         | Cross-argument requirement groups (e.g., `[["min", "max"]]` for `length` and `numeric`).                                                                                                                                                                |
| `additionalParameters`   | `boolean \| DataType`                                |    No    |     `false`      | Whether undeclared arguments are permitted (closed by default).                                                                                                                                                                                         |
| `deprecated`             | `boolean`                                            |    No    |     `false`      | Marks the function as deprecated.                                                                                                                                                                                                                       |
| `deprecatedReason`       | `string`                                             |    No    |        —         | Migration guidance when deprecated.                                                                                                                                                                                                                     |

---

## Type system and binding semantics

The format separates **unnamed types** (`DataType`, `ComponentType` — used for array `items`, `additionalProperties` value schemas, `union` variants, `returnType`, and root `types` entries) from **named parameters** (`DataParameter`, `ComponentParameter` — used in `parameters` and `properties` arrays). A named parameter flattens `name` (required) and `required` (optional boolean, default `false`) onto the type object, and closed `unevaluatedProperties: false` ensures unnamed types reject `name`/`required` while named parameters require `name`.

All types accept optional `description`, `deprecated`, and `deprecatedReason`.

### Binding model

Instead of separate `DynamicString` / `DynamicNumber` / `DynamicBoolean` / `DynamicStringList` / `DynamicValue` wrapper schemas or `if`/`then` workarounds for constrained dynamic strings, binding is orthogonal to data type:

1. **Static (default, `dynamic: false` or omitted):** Only a literal value matching the type is allowed. Inference formats such as Express annotate these as `(static)`; `NodeResolver` exposes the literal value directly without wrapping it in a `ResolvedBinding`.
2. **Full dynamic (`dynamic: true`):** Accepts a literal matching the type (including all its constraints such as `format`, `pattern`, `min`, `max`, `values`), a `DataBinding` (`{"@path": "..."}` in v1.0, `{"path": "..."}` in v0.9), or a `FunctionCall` (`{"@call": "..."}` in v1.0, `{"call": "..."}` in v0.9).
3. **Binding-only or call-only:** Use `"type": "dataBinding"` or `"type": "functionCall"` directly when literals are disallowed (for example, a write-only model path or computed expression).
4. **Literal-or-binding without function calls:** Compose `"type": "union"` with `{"type": "dataBinding"}` as one of the `variants` (for example, `Icon.name` in the Basic Catalog).

### Data types (valid everywhere)

| `type`           | Additional fields                                                                                                                            | Semantics and v1.0 JSON Schema mapping                                                                                                                                                                                                                      |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"string"`       | `dynamic?`, `format?` (`string \| string[]`), `pattern?`, `minLength?`, `maxLength?`, `default?`                                             | Static string or `DynamicString` (with literal-branch format/pattern/length constraints when `dynamic: true`).                                                                                                                                              |
| `"number"`       | `dynamic?`, `min?`, `max?`, `default?`                                                                                                       | Floating-point number or `DynamicNumber`.                                                                                                                                                                                                                   |
| `"integer"`      | `dynamic?`, `min?`, `max?`, `default?`                                                                                                       | Integer number (or dynamic integer).                                                                                                                                                                                                                        |
| `"boolean"`      | `dynamic?`, `default?`                                                                                                                       | Boolean or `DynamicBoolean` (which coerces `ValidationResult` objects at runtime in v1.0).                                                                                                                                                                  |
| `"enum"`         | `values` (required, non-empty unique array), `valueType?` (`"string" \| "number" \| "boolean"`, default `"string"`), `dynamic?`, `default?`  | Closed set of literal values (or dynamic enum).                                                                                                                                                                                                             |
| `"const"`        | `value` (required: `string \| number \| boolean \| null`)                                                                                    | Fixed literal value (for tagged union discriminators).                                                                                                                                                                                                      |
| `"any"`          | `dynamic?`, `nullable?` (default `false`), `default?`                                                                                        | When `dynamic: true` and `nullable: false`, maps to `common_types.json#/$defs/DynamicValue` (forbidding unescaped single-`@` keys in literal objects). When `dynamic: true` and `nullable: true`, maps to unconstrained `{}` (e.g., `required.args.value`). |
| `"object"`       | `dynamic?`, `properties?` (`DataParameter[]`), `additionalProperties?` (`boolean \| DataType`, default `false`), `atLeastOneOf?`, `default?` | Structured object (closed by default) or typed map when `additionalProperties` is a `DataType`.                                                                                                                                                             |
| `"array"`        | `dynamic?`, `items?` (`DataType`), `minItems?`, `maxItems?`, `uniqueItems?`, `default?`                                                      | Array of elements. `{"type": "array", "items": {"type": "string"}, "dynamic": true}` maps to `DynamicStringList`.                                                                                                                                           |
| `"union"`        | `variants` (required, `minItems: 2`), `exclusive?` (default `true`), `dynamic?`, `default?`                                                  | Disjoint (`oneOf` when `exclusive: true`) or overlapping (`anyOf` when `exclusive: false`) leaf union.                                                                                                                                                      |
| `"dataBinding"`  | —                                                                                                                                            | Wire `DataBinding` (`common_types.json#/$defs/DataBinding`).                                                                                                                                                                                                |
| `"functionCall"` | —                                                                                                                                            | Wire `FunctionCall` (`common_types.json#/$defs/FunctionCall`).                                                                                                                                                                                              |
| `"ref"`          | `ref` (required `Identifier`), `default?`                                                                                                    | Reference to a catalog-local leaf type defined in root `types`. Must resolve within the same catalog document.                                                                                                                                              |

### Component-only types (valid only in component parameters, recursively inside objects, arrays, and unions)

| `type`            | Semantics and v1.0 / v0.9 JSON Schema mapping                                                                                                |
| :---------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `"child"`         | Reference to a single child component ID (`common_types.json#/$defs/Child` in v1.0; `ComponentId` in v0.9).                                  |
| `"childList"`     | Static array of child IDs or data-model template (`common_types.json#/$defs/ChildList`).                                                     |
| `"action"`        | Interaction handler triggering an agent event or local/agent function call (`common_types.json#/$defs/Action`).                              |
| `"checkRule"`     | Single validation check rule (`common_types.json#/$defs/CheckRule`). Prefer `checkable: true` on the component for standard `@checks`.       |
| `"accessibility"` | Accessibility attributes object (`common_types.json#/$defs/AccessibilityAttributes`). Prefer the protocol `@accessibility` envelope in v1.0. |

---

## Bidirectional mapping to JSON Schema

SDKs provide a dedicated JSON Schema adapter so existing v0.9, v0.9.1, and v1.0 JSON Schema catalogs and tools continue working without breaking changes.

### Catalog Document to v1.0 JSON Schema (`toJsonSchema`)

1. Emit root `$schema` (`https://json-schema.org/draft/2020-12/schema`), `$id` (`catalogId`), `protocolVersion`, `catalogId`, and optional `title`, `description`, `instructions`, `metadata`.
2. Translate each entry in `types` into `$defs.<Name>` as a leaf JSON Schema.
3. For each `ComponentDefinition`:
   - Add `"component": {"const": "<name>"}` to `properties` and include `"component"` in `required`.
   - Translate each `ComponentParameter` in declaration order into `properties.<param.name>`, adding required parameters to `required`.
   - If `checkable` is `true`, wrap the object schema with `"allOf": [{"$ref": "common_types.json#/$defs/Checkable"}, <objectSchema>]`.
   - Copy `allowedParents`, `allowedChildren`, `metadata`, `description`, `deprecated`, and `deprecatedReason` (mapped to `x-deprecated-reason`).
4. For each `FunctionDefinition`:
   - Emit wire `FunctionCallValidationSchema` with `"@call": {"const": "<name>"}` (or `"call"` for v0.9) and `"args"` closed with `"unevaluatedProperties": false` (or `additionalProperties` per `additionalParameters`).
   - Emit `atLeastOneOf` with one group `[["min", "max"]]` as `"anyOf": [{"required": ["min"]}, {"required": ["max"]}]`. Emit multiple groups `[["a", "b"], ["c", "d"]]` conjunctively as `"allOf": [{"anyOf": [{"required": ["a"]}, {"required": ["b"]}]}, {"anyOf": [{"required": ["c"]}, {"required": ["d"]}]}]` so every group is satisfied simultaneously.
   - Map `returnType` to its v1.0 category string (`"integer"` widens to `"number"` for v1.0 enum compatibility; structured `DataType` return schemas map to their top-level type category).
   - Emit `allowedCallers` (when non-default) and `requiresUserActivation` (when `true`).
5. Synthesize `$defs.anyComponent` (with `discriminator: {"propertyName": "component"}`) and `$defs.anyFunction` (`{"not": {}}` when `functions` is empty).
6. For pre-1.0 (`protocolVersion` `< 1.0`), emit `surfaceProperties` as `$defs.theme` and wrap components with `ComponentCommon`.

### JSON Schema to Catalog Document (`fromJsonSchema`)

1. Recognize the 14 allowed `common_types.json#/$defs/*` references (both v1.0 relative `common_types.json#/$defs/...` and v0.9 versioned URLs) and map them directly to canonical `TypeDefinition` variants (`DynamicString` -> `{type: "string", dynamic: true}`, `Child`/`ComponentId` -> `{type: "child"}`, `ChildList` -> `{type: "childList"}`, `Action` -> `{type: "action"}`, `DynamicStringList` -> `{type: "array", items: {type: "string"}, dynamic: true}`, `DynamicValue` -> `{type: "any", dynamic: true}`).
2. Recognize constrained dynamic patterns (`oneOf: [{type: "string", format: "uri"}, DataBinding, FunctionCall]` and `allOf: [DynamicString, {if: {type: "string"}, then: {oneOf: [{format: "date"}, ...]}}]`) and collapse them cleanly into `{type: "string", dynamic: true, format: ...}`.
3. Recognize `allOf` referencing `Checkable` and set `checkable: true`, stripping protocol envelope properties (`component`, `id`, `@catalogId`, `@accessibility`, `@metadata`, `@checks`) while preserving any custom properties that happen to share bare names.
4. Translate local leaf `$defs` (excluding `anyComponent`, `anyFunction`, `theme`, and v0.9 `CatalogComponentCommon`) into root `types` and convert `#/$defs/<Name>` references to `{type: "ref", ref: "<Name>"}`.
5. For any exotic legacy JSON Schema construct that cannot be represented in the Catalog Document format (such as `patternProperties` or arbitrary `not` on a legacy function schema), SDK in-memory models preserve an internal raw-schema fallback node so existing JSON Schema callers experience zero regressions.

---

## Authoring guide

### Minimal component catalog

```json
{
  "$schema": "https://a2ui.org/specification/proposals/catalog_schema/catalog_schema.json",
  "formatVersion": "1.0",
  "catalogId": "https://example.com/catalogs/status/v1",
  "protocolVersion": "1.0",
  "title": "Status Catalog",
  "components": [
    {
      "name": "StatusBadge",
      "description": "Displays a short status label with an optional click action.",
      "parameters": [
        {
          "name": "label",
          "type": "string",
          "dynamic": true,
          "required": true,
          "description": "Text shown inside the badge."
        },
        {
          "name": "tone",
          "type": "enum",
          "values": ["neutral", "info", "success", "warning", "error"],
          "default": "neutral",
          "description": "Visual tone of the badge."
        },
        {
          "name": "onTap",
          "type": "action",
          "description": "Action invoked when the user taps the badge."
        }
      ]
    }
  ]
}
```

### Complete worked examples

1. [`examples/basic_v1.catalog.json`](examples/basic_v1.catalog.json) — Complete v1.0 Basic Catalog (18 components, 14 functions, `Weight` local type, `Icon.name` union, `DateTimeInput` multi-format dynamic strings, `length`/`numeric` `atLeastOneOf` constraints, `openUrl` user activation).
2. [`examples/mcp_v1.catalog.json`](examples/mcp_v1.catalog.json) — Complete v1.0 MCP Catalog (`McpApp` with typed map properties and `boolean | object` unions, plus 5 functions).
3. [`examples/vegachart_v1.catalog.json`](examples/vegachart_v1.catalog.json) — Complete v1.0 VegaChart Catalog.
4. [`examples/complex_example.catalog.json`](examples/complex_example.catalog.json) — Nested objects, dynamic arrays, local enum type reference, and structured array-of-objects function return type.

### Validation

Run the proposal validation script to verify the meta-schema, all positive examples, Unicode UAX #31 identifiers, and negative rejection cases:

```bash
python3 specification/proposals/catalog_schema/validate_proposal.py
```
