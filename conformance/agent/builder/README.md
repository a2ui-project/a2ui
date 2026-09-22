# A2UI Fluent Builder Conformance Test Suite

Cross-language golden files verifying that every A2UI fluent builder produces
identical, spec-valid wire output from identical input.

## How the suite is structured

[`builder.yaml`](builder.yaml) declares each case: a builder AST, the surface to
target, and the golden file the output must match. It is language-agnostic, so a
Python, Dart or TypeScript builder can be held to the same cases without
restating them.

Every case produces the same shape: a list of A2UI message envelopes. That
uniformity is what lets a runner have one code path and, more importantly, lets
the whole suite be checked by the A2UI validator rather than only diffed.

## Two assertions, not one

A golden that is only diffed against pins whatever the implementation happened
to emit, bugs included. That is not hypothetical here: a wrong `Action` key, a
wrong `DynamicChildList` shape and an invented `callId` property all survived
review inside goldens generated from implementation output.

So each case is checked twice:

1. Builder output equals the golden. Catches unintended change.
2. The golden passes the A2UI validator. Catches the golden being wrong.

Regeneration is gated on the same validator, so an invalid payload cannot be
recorded in the first place.

Each case declares which integrity relaxations it needs under `validation:`, and
the defaults are all false. A case that needs `allow_dangling_references` is
claiming its payload is an incremental patch against an existing surface, and
that claim belongs in the fixture rather than in runner logic.

## Cases

1. **`01_primitive_components`**: Static primitives and strict enum variants,
   emitted as an unparented forest.
2. **`02_nested_hierarchy_and_slots`**: Deep nesting across single (`child`) and
   multi-child (`children`) container slots.
3. **`03_automatic_id_allocation`**: Deterministic ID allocation and the macro
   namespacing applied when a `root_id` anchor is supplied.
4. **`04_data_bindings`**: Data model references preserving both the relative and
   the absolute path form.
5. **`05_accessibility_attributes`**: Accessibility attributes, including a
   dynamically bound value.
6. **`06_actions_and_function_calls`**: Both `Action` branches: a server event
   with a typed context map, and a client `functionCall`.
7. **`07_dynamic_child_list`**: Collection-bound children, where the template is
   an ordinary sibling component referenced by `componentId` and its bindings
   stay relative to the item scope.
8. **`08_component_references`**: External slot references preserved verbatim,
   never re-allocated or re-emitted.
9. **`09_surface_lifecycle_envelopes`**: A full lifecycle of `createSurface`,
   `updateComponents` and `updateDataModel`.
10. **`10_validation_rules`**: Client-side `CheckRule` checks on a checkable
    component.
11. **`11_nested_collection_templates`**: Two-level templates, where the inner
    list is addressed relative to the outer item scope.

## Regenerating the goldens

From the Python SDK directory:

```bash
uv run --project . python3 tests/conformance/regenerate_goldens.py
```

A case whose payload fails validation is reported and its golden is left
untouched.
