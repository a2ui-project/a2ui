# A2UI Fluent Builder Conformance Test Suite

This directory contains cross-platform golden JSON files verifying the serialization semantics of A2UI fluent builders.

## Golden Files (`golden/`)

1. **`01_primitive_components.json`**: Static primitive components (Text, Divider, weights, strict variants).
2. **`02_nested_hierarchy_and_slots.json`**: Deep nesting across single (`child`) and multi-child (`children`) container slots (Card, Column, Row, Button, Icon).
3. **`03_automatic_id_allocation.json`**: Scoped deterministic ID allocation using `IdAllocator`.
4. **`04_data_bindings.json`**: Client state data model references using `DataBinding` and normalized slash paths.
5. **`05_accessibility_attributes.json`**: Native Pydantic serialization of `AccessibilityAttributes` (label, description, live regions, dynamic hidden states).
6. **`06_actions_and_function_calls.json`**: Server event actions with typed context maps, client function actions, catalog function wrappers, and `callId` field aliasing.
7. **`07_dynamic_child_list.json`**: Collection-bound templated component lists with model paths and child template flattening.
8. **`08_component_references.json`**: External surface slot references (`ComponentRef` / `ExternalComponentBuilderNode`) preserved verbatim without re-allocating or re-emitting.
9. **`09_surface_lifecycle_envelopes.json`**: Packaging component trees into standard A2UI envelopes (`createSurface`, `updateComponents`, `updateDataModel`).
10. **`10_validation_rules.json`**: Client-side validation rules (`CheckRule`) combining function conditions with user-facing messages.
