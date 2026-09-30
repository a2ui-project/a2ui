---
name: a2ui-generate-pydantic-models
description: Automated generator for strongly typed Pydantic v2 data models and basic catalogs across any A2UI protocol version (v0.8, v0.9, v0.9.1, v1.0, etc.).
---

# A2UI Pydantic Model Generation Skill

This skill provides an automated code generation tool that produces strongly typed Pydantic v2 data models and basic catalog definitions for `python/a2ui_core` directly from the schemas and catalogs in `specification/<version>/`.

---

## Agent Execution Steps

When given a prompt like _"Generate Pydantic model classes for A2UI spec v1.0"_:

1. **Extract the target version parameter from the prompt** (e.g. `v1.0` -> `v1.0`).

2. **Execute the generator script exactly once for that target version**:

   ```bash
   uv run python .agents/skills/a2ui-generate-pydantic-models/scripts/codegen_pydantic.py --version <TARGET_VERSION>
   ```

   _(Replace `<TARGET_VERSION>` with the single requested version, e.g. `--version v1.0`)_.

3. **Format generated Python code**:

   ```bash
   cd python/a2ui_core
   uv run pyink .
   ```

4. **Verify the generated files** by running pytest:

   ```bash
   cd python/a2ui_core
   uv run pytest tests/test_codegen_pydantic.py
   ```

5. **Stop and report completion to the user.**

---

## Generated Output Files per Version

When executed for a target version `<version>` (e.g. `v1.0` -> `v1_0`), the script generates:

1. **`python/a2ui_core/src/a2ui/core/schema/<version>/`**:
   - `constants.py`
   - `common_types.py` (strongly typed shared models and the `COMMON_TYPES_DEFS` manifest mapping each spec `$defs` name to its symbol; type aliases such as `ComponentId`, `Child`, `ChildList`, and the `Dynamic*` unions are registered as `Annotated[..., Field(description=...)]` using the spec descriptions, so the runtime JSON schema generator needs no per-def special cases. When a `Dynamic*` def constrains its function-call branch with a `returnType` const, the branch is `Annotated[FunctionCall, _ReturnType("<type>")]`, which both validates the return type and emits the spec's `allOf` constraint. `FunctionCall` is flattened into a model that validates any call without the catalog. The spec's composition keywords (for example v1.0's `allOf` over `FunctionCommon` and the catalog's `anyFunction`) are emitted by a generated `__get_pydantic_json_schema__` that builds `$ref`s from the models with the internal `a2ui.core.schema._json_schema` helpers (`model_ref`, `catalog_functions`). v0.9's precise `args` shape is a schema-only `JsonSchemaAs` annotation, requested through the `x-python-type` property override, so validation stays `dict[str, Any]`. These hooks apply only inside `spec_schema()`, which the published common types schema uses; catalogs keep the flat shape. Other keywords that model fields cannot produce (`returnType`, `unevaluatedProperties`, `title`, `allowedParents`, and `oneOf` required-alternatives, see `_SPEC_KEYWORDS`) are added by the same generated hook on models that declare properties. A `oneOf` whose branches only list required fields (for example `FunctionResponse`'s `value`/`error`) also gets a `model_validator` that requires exactly one branch. Nested object properties with their own properties become helper models named `<Parent><Property>` (for example `ComponentCommonMetadata`, `IndexSystemFunctionArgs`, `FunctionResponseError`), which the published schema inlines. Primitive defs such as `CallId` are `TypeAliasType`s, so references keep their `$ref`; `patternProperties` objects (`Extensions`) are `TypeAliasType`s over a key-checking validator, whose pattern is emitted with `JsonSchemaKeywords(..., spec_only=True)` because Python's `re` cannot compile `\p{...}`. The `DynamicValue` literal-object branch carries the spec's `not` clause through `JsonSchemaKeywords` in both modes, and dynamic unions list their members in spec order. Common types keep `component` properties (`Surface`) and emit required consts without defaults (`skip_component_property` and `required_const_default` on the engine). Spec defaults are emitted as JSON schema `default` values (`schema_defaults`), not as description notes. No spec schema is copied verbatim)
   - `agent_to_renderer.py` / `server_to_client.py`
   - `renderer_to_agent.py` / `client_to_server.py`
   - `renderer_capabilities.py` / `client_capabilities.py`
   - `agent_capabilities.py` / `server_capabilities.py` (when present in spec)
   - `catalog_definition.py` (when present in spec)
   - `__init__.py`

2. **`python/a2ui_core/src/a2ui/core/basic_catalog/<version>/`**:
   - `components.py` (strongly typed components & `ModelComponentApi` registrations)
   - `function_apis.py` (strongly typed function schemas & `FunctionApi` classes)
   - `styles.py` (theme schema, generated when theme is defined in catalog)
   - `__init__.py`

3. **`python/a2ui_core/src/a2ui/core/schema/__init__.py`**:
   - Registers the version in `A2uiProtocolVersion` enum and updates envelope unions.
