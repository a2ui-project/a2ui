# A2UI macros conformance test suite

Cross-language conformance suite verifying that A2UI macro expansion, parameter coercion, catalog synthesis, multi-catalog scoping, and error handling produce identical, spec-valid output across SDK implementations.

## How the suite is structured

[`macros.yaml`](macros.yaml) declares three sections:

1. `custom_catalogs` maps custom `catalogId` URIs (`foo`, `bar`, `brand`, `brand_surface`, `theme`, `charts`, `catalog_a`, and `catalog_b`) to inline v1.0 JSON Schema catalog definitions used in multi-catalog expansion and validation cases.
2. `macros` lists the reference macro definitions. Each macro specifies its parameter types, description, optional `protocol_version`, optional `catalog_id` scoping the macro to cases with a matching `macro_catalog_id`, and a declarative builder AST `template:` matching the AST syntax in [`../builder/builder.yaml`](../builder/builder.yaml) (along with inline comments noting imperative transforms such as `status.upper()` or `count < 0` validation).
3. `tests` lists the conformance test cases. Transport cases provide either a single-surface `input` (with optional `surface_id` and `catalog_id`) or a full `messages` sequence (`createSurface`, `updateComponents`, `deleteSurface`), along with optional `envelope_version` (defaulting to `"v0.9"`), `macro_version`, `macro_catalog_id`, `expander_scoped`, `expander_catalog_id`, `base_catalogs`, `validation_catalogs`, `surface_catalogs`, and `on_error` (`"passthrough"` or `"raise"`). Non-transport cases set `action` to `to_catalog`, `transform_to_inference_catalog`, `transform_catalog`, or `transform_to_inference`.

### Parameter type vocabulary

Each entry under `macros[].parameters` declares a `type` key (plus optional `enum`, `default`, and `required: false`). Implementations map these types to synthesized JSON Schema properties and runtime argument coercions as follows:

| YAML `type`           | Synthesized JSON Schema                                                | Runtime coercion                                                                                                |
| :-------------------- | :--------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| `string`              | `{type: "string"}` (plus `enum` when declared)                         | Primitive string (dict bindings rejected).                                                                      |
| `integer`             | `{type: "integer"}`                                                    | Primitive integer (booleans and dict bindings rejected).                                                        |
| `number`              | `{type: "number"}`                                                     | Primitive number (booleans and dict bindings rejected).                                                         |
| `boolean`             | `{type: "boolean"}`                                                    | Primitive boolean (interpolated lowercase as `"true"` / `"false"` in `${...}`).                                 |
| `component`           | `common_types.json#/$defs/Child` (v1.0) or `ComponentId` (v0.9)        | Component ID string coerced to a `ComponentRef`.                                                                |
| `component_list`      | `common_types.json#/$defs/ChildList`                                   | Static array of component ID strings coerced to `ComponentRef` items (rejects template maps).                   |
| `child_list`          | `common_types.json#/$defs/ChildList`                                   | Static ID array or `DynamicChildList` template map (`{path, componentId}` in v1.0, `{path, template}` in v0.9). |
| `action`              | `common_types.json#/$defs/Action`                                      | Event name string, shorthand event/call map, or full `Action` map coerced to `Action`.                          |
| `dynamic_string`      | `common_types.json#/$defs/DynamicString`                               | Literal string, `@path` / `path` `DataBinding`, or `@call` / `call` `FunctionCall`.                             |
| `dynamic_number`      | `common_types.json#/$defs/DynamicNumber`                               | Literal number, `DataBinding`, or `FunctionCall`.                                                               |
| `dynamic_boolean`     | `common_types.json#/$defs/DynamicBoolean`                              | Literal boolean, `DataBinding`, or `FunctionCall`.                                                              |
| `dynamic_string_list` | `common_types.json#/$defs/DynamicStringList`                           | String array, `DataBinding`, or `FunctionCall`.                                                                 |
| `dynamic_value`       | `common_types.json#/$defs/DynamicValue`                                | `DataBinding` or `FunctionCall`, preserving plain `path` and `call` maps in v1.0 as `LiteralObject` values.     |
| `check_rule_list`     | `{type: "array", items: {$ref: "common_types.json#/$defs/CheckRule"}}` | Array of `CheckRule` objects.                                                                                   |
| `accessibility`       | `common_types.json#/$defs/AccessibilityAttributes`                     | `AccessibilityAttributes` object passed to the macro instead of merging onto the root.                          |

### Macro template AST sentinels

The declarative `template:` structure reuses the builder AST conventions:

1. `{$param: "name"}` injects the argument value passed for parameter `name` (such as a child slot, binding, action, or string).
2. `{$spreadParam: "name"}` spreads an array parameter into a container's children.
3. `${name}` interpolates primitive arguments into strings (for example, `"Port: ${port}"`), formatting booleans in lowercase (`"true"` / `"false"`).

Test runners implement the reference macros using native fluent builders (exercising language reflection, type annotations, and argument coercion) or synthesize them from the AST templates. See [`python/a2ui_agent/tests/conformance/macro_suite.py`](../../../python/a2ui_agent/tests/conformance/macro_suite.py) for the Python reference harness.

### Component-to-catalog resolution and primitive stamping

During `transform_to_transport`, implementations resolve component catalogs and close lowered primitives over `base_catalogs`. A v1.0 component names its catalog in the `@catalogId` envelope key (`createSurface.catalogId` and a function call's `catalogId` stay bare), and the expander emits only `@catalogId`, `@accessibility`, `@metadata`, and `@checks` on v1.0 components:

1. Explicit non-empty `@catalogId` strings take precedence (`"@catalogId": null` behaves like omitting it, whereas `""` or non-string values skip macro expansion).
2. At `depth > 0`, unannotated nested nodes inherit the enclosing macro's `@catalogId` unless the surface uses an unregistered foreign catalog or the component name belongs to a registered base catalog on that surface (or any registered base catalog on a defaultless surface).
3. Otherwise, components inherit the surface default `catalogId` from `createSurface` or `surface_catalogs`.
4. In v1.0, when `createSurface.catalogId` names the expander's standalone macro sidecar catalog, `transform_to_transport` rewrites it to the sole registered base catalog (or omits it when multiple base catalogs are registered, raising `CatalogError` if none are registered). At `depth == 0`, unannotated lowered primitives on a defaultless surface (or outside the surface's registered default catalog) receive their unique owning `@catalogId` from `base_catalogs`, raising `CatalogError` if ownership is missing or ambiguous.

## Assertions

Golden cases (`golden: "<file>.json"`) and positive transport `expect` cases are checked against both wire expectations and renderer validation:

1. `MacroExpander.transform_to_transport` output matches the golden JSON file or `expect` fields (`components`, `component_types`, `absent_property_on_all_components`, `create_surface_catalog_id`).
2. Unless `validation.skip_renderer_validation` is `true` (used by negative passthrough fallback cases), the lowered messages pass `MessageProcessor` validation against `validation_catalogs` (or the version's basic catalog) under the case's `validation` profile (`allow_missing_root`, `allow_orphan_components`, `allow_dangling_references`).

Catalog `expect` cases check schema structure, component discriminators, and protocol versions; `expect_error` cases check exception categories (`CatalogError`, `RecursionError`, `ValidationError`).

## Case groups

1. Cases `01` through `08`, `14`, and `15` test v0.9 expansion, root ID stitching, ID namespacing, slot boundaries, `Action` and `DataBinding` coercion, primitive arguments, nested macro composition, and `createSurface` lifecycle envelopes.
2. Cases `09`, `10`, and `13` test cyclic macro `RecursionError`, base-catalog name collision `CatalogError`, and unsupported envelope version `ValidationError`.
3. Cases `11`, `12`, `16`, `17`, `18`, and `23` test inference catalog synthesis across v0.9 (`ComponentId`) and v1.0 (`Child`) common types, `passthrough_components` filtering, and `transform_to_inference` passthrough.
4. Cases `19`, `30`, and `31` test component envelope propagation: stripping the macro's `@catalogId`, deep-merging v1.0 `@accessibility` and `@metadata.extensions` with root defaults, passing declared `accessibility` and `weight` parameters (custom properties, not envelope keys) to the macro, and gating v1.0-only envelope fields on v0.9 messages, where `accessibility` stays bare.
5. Cases `21`, `22`, `25`, `26`, and `32` test v1.0 parameter coercion (`@path`, `@call`, `Action` event shorthands with `userMessage` and `context`, bare `@call` `functionCall` action shorthands, `DynamicChildList`, `CheckRule` arrays, and `LiteralObject` preservation of plain `path` and `call` maps on `DynamicValue`).
6. Cases `27`, `28`, and `29` test standalone sidecar catalog export via `to_catalog` for v0.9, v1.0 (inferred version and custom `catalog_id`), and empty expanders.
7. Cases `33` and `33b` test `on_error="passthrough"` fallback (retaining failed macro components while expanding valid siblings) and `on_error="raise"` (raising `ValidationError` on invalid macro invocations).
8. Cases `20` and `34` through `38b` test mixable catalogs, `base_catalogs` closure, and surface scoping: multi-catalog macros (`FooCatalog` + `BarCatalog` + `BazMacro`) on defaultless and themed surfaces, auto-stamping unique `base_catalogs` catalog IDs as `@catalogId` onto unannotated lowered primitives (and raising `CatalogError` on ambiguous ownership), `deleteSurface` + `createSurface` default changes, `"@catalogId": null`, stateless `surface_catalogs` overrides, skipping untracked surfaces on scoped expanders, rewriting standalone macro-sidecar `createSurface.catalogId` defaults, same-name primitive wrappers, and nested deferred macro catalog inheritance without sibling macro hijacking.
9. Cases `24`, `39a` through `39c`, `40a` through `40i`, and `41` test deferred self and mutual recursion errors, single-version enforcement across v0.9 and v1.0, and v1.0 UAX #31 identifier and reserved `Surface` validation rules.
