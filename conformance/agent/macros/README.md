# A2UI Macros Conformance Test Suite

Cross-language golden files verifying that A2UI macro expansion and parameter coercion produce identical, spec-valid wire output across all SDK implementations.

## How the suite is structured

[`macros.yaml`](macros.yaml) declares:

1. **The reference macro definitions**: Each macro specifies its parameter types, docstring description, and a declarative builder AST `template:` (matching the AST syntax from `builder.yaml`).
2. **The test cases**: Each case specifies an input message envelope containing a macro invocation, the target surface, any validator relaxations, and the golden file the expanded output must match.

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

1. **`01_status_badge_expansion`**: Basic macro returning a Card with nested Row and Text components, verifying root stitching and ID namespacing.
2. **`02_slot_boundary_preservation`**: Single child slot parameter coerced from external component ID string to `ComponentRef`, preserving the external ID without namespacing or re-emission.
3. **`03_multi_slot_list_coercion`**: Multi-child slot list parameter coerced from list of component ID strings, preserving slot boundaries.
4. **`04_action_string_coercion`**: Action parameter coerced from string event name to standard Action wire format (`{"event": {"name": ...}}`).
5. **`05_data_binding_coercion`**: Dynamic string parameter coerced from data model binding dictionary (`{"path": ...}`).
6. **`06_primitive_and_dict_arguments`**: Primitive arguments (string, integer, boolean) formatted into UI output.
7. **`07_nested_macro_composition`**: Macro composing another macro within its returned tree, verifying recursive expansion and namespacing.
8. **`08_surface_lifecycle_envelopes`**: Full surface lifecycle message packaging `createSurface` and `updateComponents`.
