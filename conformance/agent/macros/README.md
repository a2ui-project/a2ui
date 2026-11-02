# A2UI Macros Conformance Test Suite

Cross-language golden files verifying that A2UI macro expansion and parameter coercion produce identical, spec-valid wire output across all SDK implementations.

## How the suite is structured

[`macros.yaml`](macros.yaml) declares:

1. **The reference macro definitions**: Each macro specifies its parameter types, docstring description, an optional `catalog_id` scoping the macro exclusively to test cases with a matching `macro_catalog_id` (macros without `catalog_id` are registered when `macro_catalog_id` is unset), and a declarative builder AST `template:` (matching the AST syntax from `builder.yaml`).
2. **The test cases**: Each case specifies an input message envelope containing a macro invocation, the target surface, any validator relaxations, optional `envelope_version` and `macro_catalog_id` scoping, and the golden file the expanded output must match.

### Macro template AST sentinels

The declarative `template:` structure reuses the builder AST conventions:

- `{$param: "name"}`: Injects the argument value passed for parameter `name` (e.g. child slot, binding, action, or string).
- `{$spreadParam: "name"}`: Spreads an array parameter (e.g. `items` list) into a container's children.
- `${name}`: String interpolation for primitive arguments (e.g. `"Port: ${port}"`).

Test runners implement the reference macros using native language fluent builders (testing language reflection, type hint inspection, and argument coercion) or synthesize them from the AST templates.

## Two assertions

Each case is checked twice:

1. Macro expansion output equals the golden file. Catches unintended change and drift across languages.
2. The golden passes the A2UI validator. Verifies that macro expansions always generate valid protocol wire messages.

## Cases

- **`01_status_badge_expansion`**: Basic macro returning a Card with nested Row and Text components, verifying root stitching and ID namespacing.
- **`02_slot_boundary_preservation`**: Single child slot parameter coerced from external component ID string to `ComponentRef`, preserving the external ID without namespacing or re-emission.
- **`03_multi_slot_list_coercion`**: Multi-child slot list parameter coerced from list of component ID strings, preserving slot boundaries.
- **`04_action_string_coercion`**: Action parameter coerced from string event name to standard Action wire format (`{"event": {"name": ...}}`).
- **`05_data_binding_coercion`**: Dynamic string parameter coerced from data model binding dictionary (`{"path": ...}`).
- **`06_primitive_and_dict_arguments`**: Primitive arguments (string, integer, boolean) formatted into UI output.
- **`07_nested_macro_composition`**: Macro composing another macro within its returned tree, verifying recursive expansion and namespacing.
- **`08_surface_lifecycle_envelopes`**: Full surface lifecycle message packaging `createSurface` and `updateComponents`.
- **`09`–`18`**: Error handling, parameter coercion, schema synthesis, `passthrough_components`, and `transform_to_inference` identity cases (see `macros.yaml`).
- **`19_envelope_attributes_preservation`**: Macro invocations with component envelope attributes (`catalogId`, `accessibility`, `metadata`) expand cleanly, merging `accessibility` and `metadata` onto the expanded root without copying macro `catalogId` onto emitted primitives.
- **`20_mixable_catalogs_resolution`**: Mixable catalogs resolve macros by effective `catalogId` without colliding with identically named primitives from other catalogs.
- **`21_v1_0_data_binding_and_function_call_coercion`**: v1.0 macro coerces `@path` data bindings and `@call` function calls into `DynamicString` slots.
- **`22_v1_0_action_user_message_coercion`**: v1.0 `Action` parameter coerces a bare event body with `userMessage` and `context`.
- **`23_v1_0_synthetic_catalog_generation`**: Deriving a v1.0 inference catalog from `a2ui.builder.v1_0` macro annotations synthesizes valid schemas and preserves protocol version `1.0`.
- **`24_error_reserved_surface_macro_name`**: Transforming a v1.0 catalog with a macro named `Surface` raises `ValidationError` because `Surface` is reserved in v1.0.
- **`25_v1_0_literal_object_preservation`**: v1.0 `DynamicValue` parameters preserve plain `{"path": ...}` and `{"call": ...}` dictionaries as `LiteralObject` values without coercing them to `DataBinding` or `FunctionCall`.
- **`26_v1_0_dynamic_child_list_and_checks`**: v1.0 macro coerces `DynamicChildList` templates, `CheckRule` arrays, and abbreviated `event` action shorthands preserving `userMessage` and `context`.
