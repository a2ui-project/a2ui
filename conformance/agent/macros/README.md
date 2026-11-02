# A2UI macros conformance test suite

Cross-language conformance suite verifying that A2UI macro expansion, parameter coercion, catalog synthesis, multi-catalog scoping, and error handling produce identical, spec-valid output across all SDK implementations.

## How the suite is structured

[`macros.yaml`](macros.yaml) declares three sections:

1. `custom_catalogs` maps custom `catalogId` URIs (`foo`, `bar`, `brand`, `brand_surface`, `theme`, `charts`, `catalog_a`, and `catalog_b`) to inline v1.0 JSON Schema catalog definitions used in multi-catalog expansion and validation cases.
2. `macros` lists the reference macro definitions. Each macro specifies its parameter types, description, optional `protocol_version`, optional `catalog_id` scoping the macro to cases with a matching `macro_catalog_id`, and a declarative builder AST `template:` matching the AST syntax in [`../builder/builder.yaml`](../builder/builder.yaml).
3. `tests` lists the conformance test cases. Transport cases provide either a single-surface `input` (with optional `surface_id` and `catalog_id`) or a full `messages` sequence (`createSurface`, `updateComponents`, `deleteSurface`), along with optional `envelope_version`, `macro_version`, `macro_catalog_id`, `expander_scoped`, `base_catalogs`, `validation_catalogs`, and `surface_catalogs`. Non-transport cases set `action` to `to_catalog`, `transform_to_inference_catalog`, `transform_catalog`, or `transform_to_inference`.

### Macro template AST sentinels

The declarative `template:` structure reuses the builder AST conventions:

1. `{$param: "name"}` injects the argument value passed for parameter `name` (such as a child slot, binding, action, or string).
2. `{$spreadParam: "name"}` spreads an array parameter into a container's children.
3. `${name}` interpolates primitive arguments into strings (for example, `"Port: ${port}"`).

Test runners implement the reference macros using native fluent builders (exercising language reflection, type annotations, and argument coercion) or synthesize them from the AST templates. See [`python/a2ui_agent/tests/conformance/macro_suite.py`](../../../python/a2ui_agent/tests/conformance/macro_suite.py) for the Python reference harness.

## Assertions

Golden cases (`golden: "<file>.json"`) are checked twice:

1. `MacroExpander.transform_to_transport` output equals the golden JSON file.
2. The golden JSON passes `MessageProcessor` validation against `validation_catalogs` (or the version's basic catalog) under the case's `validation` profile.

Non-golden cases check either `expect` assertions (catalog schema structure, component discriminators, or graceful fallback retention) or `expect_error` exception categories (`CatalogError`, `RecursionError`, `ValidationError`).

## Case groups

1. Cases `01` through `08`, `14`, and `15` test v0.9 expansion, root ID stitching, ID namespacing, slot boundaries, `Action` and `DataBinding` coercion, primitive arguments, nested macro composition, and `createSurface` lifecycle envelopes.
2. Cases `09`, `10`, and `13` test cyclic macro `RecursionError`, base-catalog name collision `CatalogError`, and unsupported envelope version `ValidationError`.
3. Cases `11`, `12`, `16`, `17`, `18`, and `23` test inference catalog synthesis across v0.9 and v1.0 common types, `passthrough_components` filtering, and `transform_to_inference` passthrough.
4. Cases `19`, `30`, and `31` test component envelope propagation: stripping macro `catalogId`, deep-merging undeclared `accessibility` and v1.0 `metadata.extensions` with root defaults, passing declared `accessibility` and `weight` parameters to the macro, and gating v1.0-only envelope fields on v0.9 messages.
5. Cases `21`, `22`, `25`, `26`, and `32` test v1.0 parameter coercion (`@path`, `@call`, `Action` event shorthands with `userMessage` and `context`, bare `@call` `functionCall` action shorthands, `DynamicChildList`, `CheckRule` arrays, and `LiteralObject` preservation of plain `path` and `call` maps on `DynamicValue`).
6. Cases `27`, `28`, and `29` test standalone sidecar catalog export via `to_catalog` for v0.9, v1.0 (inferred version and custom `catalog_id`), and empty expanders.
7. Case `33` tests graceful fallback in `transform_to_transport` when a macro receives undeclared properties (`weight`), binding dicts for primitive parameters, or raises runtime validation errors while sibling macros expand normally.
8. Cases `20` and `34` through `38b` test mixable catalogs and surface scoping: multi-catalog macros (`FooCatalog` + `BarCatalog` + `BazMacro`) on defaultless and three-catalog surfaces, absence of auto-stamped `catalogId` on unannotated builder nodes, `deleteSurface` + `createSurface` default changes, `catalogId: null`, stateless `surface_catalogs` overrides, skipping untracked surfaces on scoped expanders, same-name primitive wrappers, and nested deferred macro catalog inheritance without sibling macro hijacking.
9. Cases `24`, `39a` through `39c`, `40a` through `40i`, and `41` test deferred self and mutual recursion errors, single-version enforcement across v0.9 and v1.0, and v1.0 UAX #31 identifier and reserved `Surface` validation rules.
