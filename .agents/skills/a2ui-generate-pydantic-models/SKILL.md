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
   - `common_types.py`: strongly typed shared models and the `COMMON_TYPES_DEFS` manifest, which maps each spec `$defs` name to its symbol in spec order. No spec schema is copied verbatim; the published common types schema is rebuilt from these symbols.
     - Type aliases such as `ComponentId`, `Child`, `ChildList` and the `Dynamic*` unions are registered as `Annotated[..., Field(description=...)]` with the spec descriptions, so the runtime JSON schema generator needs no per-def special cases. Dynamic unions list their members in spec order.
     - When a `Dynamic*` def constrains its function-call branch with a `returnType` const, the branch is `Annotated[FunctionCall, ReturnType("<type>")]`, which validates the return type and emits the spec's `allOf` in both modes. Any other branch shape fails generation.
     - Every model extends `SpecBaseModel` (hand-written in `schema/common_types.py`) and has no generated methods. Keywords that fields cannot produce are declared in the model config as `json_schema_extra=SchemaKeywords(...)`: it drops `additionalProperties` where the spec leaves it out and adds `returnType`, `unevaluatedProperties`, `title`, `allowedParents` and `oneOf` required-alternatives (see `_SPEC_KEYWORDS`). The keywords apply only to the declaring model, not to subclasses. `SpecBaseModel` validates a declared `oneOf` whose branches only list required fields (for example `FunctionResponse`'s `value`/`error`), requiring exactly one branch.
     - Only composition that references the catalog's function union is limited to `spec_schema()` (`SchemaKeywords(..., spec_only=True)`), which the published common types schema uses: v0.9's `FunctionCall` `oneOf`, v1.0's `FunctionCall` `allOf` over `FunctionCommon` and `anyFunction` (`replace=True`, since the spec def is pure composition), and v0.9's precise `args` shape (a schema-only `JsonSchemaAs` annotation requested through the `x-python-type` property override). Catalogs keep the flat model shape there. References inside declared keywords are the markers `def_ref("<Def>")` and `catalog_functions()` from the internal `a2ui.core.schema._json_schema` module, which the schema builder resolves to `$ref`s. `FunctionCall` itself is a flat model that validates any call without the catalog.
     - Nested object properties with their own properties become helper models named `<Parent><Property>` (for example `ComponentCommonMetadata`, `IndexSystemFunctionArgs`, `FunctionResponseError`), which schemas inline. Wrapper unions such as `Action` are `TypeAliasType`s, so fields reference them by def name. Each branch gets a `<Def><Property>Wrapper` model, and a branch property that is an object becomes `<Def><Property>` (`ActionEvent`, `ActionEventWrapper`, `ActionFunctionCallWrapper`). A generated name that collides with a def, a base symbol or another helper fails generation.
     - A def that the spec leaves open (no `additionalProperties` and no `unevaluatedProperties: false`) allows extra keys. `ComponentCommon` is the exception (`_SUBCLASSED_DEFS`): generated catalog components subclass it and must stay closed.
     - Optional fields are typed `X | None` so they can be absent. `SpecBaseModel` rejects an explicit null for such a field unless `X` accepts null itself (`Any`), under both the spec name and the Python field name; it does not change the JSON schema. Catalog components inherit this rule through `ComponentCommon`. v0.9's `FunctionCall.args` also rejects null values.
     - Primitive defs such as `CallId` are `TypeAliasType`s, so local references keep their `$ref`. References from other documents to a primitive def map to its Python type through `_CROSS_DOCUMENT_REF_TYPES` in `engine.py`.
     - `patternProperties` objects (`Extensions`) are `TypeAliasType`s over a key-checking validator, and their pattern is published in the spec schema and in catalogs. Python's `re` cannot compile `\p{...}`, so the SDK validates JSON schemas with `a2ui.core.validation.SchemaValidator` (powered by `regex`). The `DynamicValue` literal-object branch carries the spec's `propertyNames` and `not` clauses through a `SchemaKeywords` annotation in both modes.
     - Common types keep `component` properties (`Surface`) and emit required consts without defaults (`skip_component_property` and `required_const_default` on the engine). Spec defaults are emitted as JSON schema `default` values (`schema_defaults`), not as description notes.
     - Common types are generated in strict mode: a schema shape the models would not enforce (an unknown or non-local `$ref`, siblings next to `$ref`/`const`/composition, an unsupported keyword next to `properties`, a required property that is not declared, an empty union) raises instead of loosening validation. Output is deterministic and does not depend on string hashing.
   - `agent_to_renderer.py` / `server_to_client.py` (a nested object inside a message payload, such as v1.0's `createSurface.metadata`, becomes a model named `<Payload><Property>`, for example `CreateSurfaceMetadata`)
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
   - For versions with a common types schema (v0.9+), the models carry everything `Catalog.catalog_schema` needs to rebuild the specification's `catalog.json` from them, with no spec JSON copied into Python:
     - A component's `allOf` references to common types defs (for example `Checkable`) become base classes, and catalog defs (`CatalogComponentCommon`) become base models. A component with more than one base sets `extra="forbid"`, because Pydantic would otherwise inherit an open base's config. A component description becomes the class docstring and fails generation if it cannot be one.
     - A function's description becomes the `FunctionApi.description` attribute. Keywords on the `args` object that fields cannot produce (`unevaluatedProperties`, `additionalProperties`, required-alternative `anyOf`) are declared with `SchemaKeywords` as the model's `json_schema_extra`, and an unknown keyword fails generation.
     - Field constraints (`minItems`, `minimum`, ...) are emitted as `Field` arguments, so they are validated and published; `format` and `default` are published through `json_schema_extra`. An `allOf` member that only adds keywords becomes a `SpecAllOf` annotation.
     - The top-level keys of `catalog.json` that are not derived from components, functions or the theme (for example `instructions`) are passed to the `Catalog` in `__init__.py` as `instructions` and `schema_metadata`.
     - The conformance cases `test_v09_basic_catalog_schema` and `test_v10_basic_catalog_schema` compare the result with the specification files, so any drift fails the tests.

3. **`python/a2ui_core/src/a2ui/core/schema/__init__.py`**:
   - Registers the version in `A2uiProtocolVersion` enum and updates envelope unions.
