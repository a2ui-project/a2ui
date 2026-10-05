## Unreleased

- **BREAKING**: `A2uiCatalog` is removed. Inference formats, prompt
  generators, parsers, skills, macros and the ADK toolset take and return the
  `a2ui.core` catalog itself, typed `CatalogApi`. The protocol schemas that
  `A2uiCatalog` carried come from the inference format or from `a2ui.core`
  (#2966). To migrate:
  - `A2uiCatalog.from_config(config, version)` becomes
    `config.to_catalog(protocol_version=version)`, and
    `A2uiCatalog.from_json_file(path)` becomes
    `CatalogConfig.from_path(name, path).to_catalog()`.
  - `core_catalog` is the catalog itself, `version` becomes
    `protocol_version`, and `name` stays on `CatalogConfig`.
  - `catalog_schema` is the schema that the core catalog generates. Unlike
    the file, it refers to common types locally, has the catalog's own
    definitions inlined, and has no `$id`, `title` or `description`.
  - `s2c_schema` and `common_types_schema` are no longer on the catalog. The
    inference format holds them, with its schema modifiers applied, and
    `get_agent_to_renderer_schema_map` and `get_common_types_schema_map` in
    `a2ui.core` return the published ones.
  - `with_pruning(allowed_components, allowed_messages)` becomes
    `ComponentPruningTransformer(allowed_components)`, applied with
    `transform` or passed to `CatalogConfig` as `transformers`, and
    `catalog_to_prompt(catalog, allowed_messages=...)`.
  - `render_as_llm_instructions()` becomes `catalog_to_prompt(catalog)` from
    `a2ui.inference_formats.direct_json`.
  - `load_examples(path, validate)` becomes
    `load_examples([catalog], path, validate)` from `a2ui.schema`.
  - `validate_components(payload)`, which returned a list of errors, becomes
    `validate_payload([catalog], payload)` from `a2ui.utils`, which raises
    `A2uiValidationError`.
  - `validator` becomes `PayloadValidator(catalog)` from `a2ui.core`.
- Add `a2ui.catalog_transformers` with `CatalogTransformer`,
  `ComponentPruningTransformer` and `FunctionPruningTransformer`.
  `CatalogConfig` takes `transformers`, which `to_catalog` applies after the
  schema modifiers (#2966).
- Add `a2ui.utils`. `resolve_catalogs` returns the catalogs that are active
  for the capabilities a renderer sent. `prune_messages_schema` and
  `prune_common_types_schema` reduce the protocol schemas. `validate_payload`
  checks a payload the way a renderer holding the catalogs would, including
  the `version` that each message states, and raises `A2uiValidationError`
  (#2966).
- Add `catalog_to_prompt` to `a2ui.inference_formats.direct_json`, which
  returns the prompt text for a catalog together with the agent-to-renderer
  schema and the common types it references, and
  `DirectJsonFormat.create_stream_parser`, which builds a stream parser with
  the format's progressive keys (#2966).
- The Direct JSON stream parser checks each message with `validate_payload`,
  which runs it through a `MessageProcessor` holding the catalog, instead of
  against the JSON agent-to-renderer schema. It no longer takes or loads the
  protocol schemas, so schema modifiers reach it only through the catalog,
  and its errors are the core's, prefixed with `Validation failed:` (#2966).
- **BREAKING**: `CatalogConfig.custom_cuttable_keys` is removed. The string
  keys that the Direct JSON stream parser heals are now a format option,
  `DirectJsonFormat(progressive_keys=...)`, which replaces the defaults. The
  defaults are exported as `DEFAULT_PROGRESSIVE_KEYS` from
  `a2ui.inference_formats.direct_json`, and an empty set turns healing off
  (#2966).
- **BREAKING**: Allowlists are read literally. An empty `allowed_components`
  now keeps no components and an empty `allowed_messages` keeps no messages;
  before, an empty list kept everything. `None` still keeps everything
  (#2966).
- **BREAKING**: `DirectJsonFormat.get_selected_catalog` raises
  `A2uiCatalogError` for an empty `supportedCatalogIds` without inline
  catalogs instead of falling back to the first catalog. It also accepts
  capabilities keyed by protocol version, such as `{"v0.9": {...}}` (#2966).
- `DirectJsonFormat.get_selected_catalog` still accepts `allowed_messages`
  but doesn't apply it, since a core catalog doesn't hold the
  agent-to-renderer schema. The prompt generator applies it when it builds
  the prompt, and the stream parser doesn't enforce it (#2966).
- `SendA2uiToClientToolset` now returns a tool error, with the validation
  message, for a payload that fails validation. Before, it ignored the errors
  that `validate_components` returned (#2966).
- The schema helpers of the Express, Elemental and Atom formats follow a
  catalog's own `$defs` references, so a catalog built from models, such as
  `BasicCatalog("0.9")`, keeps properties that it defines there, such as
  `weight` (#2966).
- **BREAKING**: The SDK no longer bundles specification JSON files.
  `load_from_bundled_resource` and `A2UI_ASSET_PACKAGE` are removed; get the
  agent-to-renderer schema from `get_agent_to_renderer_schema_map` in
  `a2ui.core` instead. `PROTOCOL_VERSION_MAP`, its alias `SPEC_VERSION_MAP`,
  `SERVER_TO_CLIENT_SCHEMA_KEY` and `COMMON_TYPES_SCHEMA_KEY`, which described
  the specification files, are removed too. The `VERSION_*` constants still
  name the supported versions (#2964).
- Building or installing the SDK from source no longer regenerates the Express
  parser, so it no longer needs Java. The generated parser stays committed; after
  changing `Express.g4`, run `scripts/generate_express_parser.py` (#2964).
- Catalogs that inference formats take or return are typed `CatalogApi` from `a2ui.core` instead of `Catalog[Any, Any]`.
- Add A2UI Macros API under `a2ui.transformers.macros` (`@macro` decorator and `MacroExpander`), enabling authoring of reusable, high-level composite components using fluent Python builder classes that lower into primitive A2UI component subtrees (`transform_to_transport`) and synthesize inference catalog schemas (`transform_to_inference_catalog`, `to_catalog`) (#2519).
- **BREAKING**: The common types schema is no longer bundled as an asset.
  `DirectJsonFormat` takes it from a2ui-core's generated schema
  (`a2ui.schema.utils.load_common_types_schema`), the same definitions that
  payload validation uses.
- Streaming validation errors quote the schema's own pattern (for example
  `\p{XID_Start}`) instead of its expansion for Python's `re` module.
- **BREAKING**: `a2ui.basic_catalog` (`BasicCatalog`, `BundledCatalogProvider`,
  and `BASIC_CATALOG_NAME`) is removed, and the basic catalog JSON files are no
  longer bundled. Use `BasicCatalog` from `a2ui.core.basic_catalog` instead:
  `BasicCatalog.get_config(version)` becomes
  `CatalogConfig.from_catalog("basic", BasicCatalog(version))`.
- Add `CatalogConfig.from_catalog` and `InMemoryCatalogProvider` (exported from
  `a2ui.schema`) to configure a catalog from an `a2ui.core` catalog instance.

## 0.7.0 (2026-09-28)

- **BREAKING**: Validation modules `a2ui.validation.*` and `a2ui.schema.validator` are removed. Use `A2uiCatalog.validate_components` for component tree validation.
- **BREAKING**: `A2uiCatalog.validator` now returns a single-catalog `PayloadValidator` instance (from `a2ui.core.validation`) instead of `A2uiValidator`. `PayloadValidator` does not provide an envelope-walking `.validate()` method; call `A2uiCatalog.validate_components` or `PayloadValidator.validate_component()` / `PayloadValidator.validate_function()`.
- **BREAKING**: `A2uiTemplateManager` is removed.
- **BREAKING**: Package dependency updated to require `a2ui-core>=0.2.0,<0.3.0`.
- Add type-safe Python Builder API under `a2ui.builder` for constructing A2UI component trees as nested objects and serializing them into protocol messages (#2425).
- `A2uiCatalog.core_catalog` now passes its `common_types_schema` through to
  `Catalog.from_json`, so a catalog that references the shared types across
  documents resolves them from that document instead of leaving the references
  unresolvable.
- Add `SkillGenerator` API and `Skill` / `SkillSet` domain models to compile inference format rules and component catalog definitions into standardized agent skill packages (`SKILL.md`) (#2516).
- Use `is_at_least_version` and `ProtocolVersion.V1_0` in `ExpressCompiler` for protocol version comparisons.
- Update `A2uiCompilationError` to forward error `details` to `A2uiError.details` and inherit directly from `A2uiError`.

## 0.6.0

- Add support for keyword arguments (`param=value`) and mixed positional/keyword argument syntax in A2UI Express DSL component constructors and catalog function calls (#2131).
- Add multi-version output support (`v0.9`, `v0.9.1`, `v1.0`) to `ExpressCompiler`, emitting standard `v0.9.1` message sequences or `v1.0` unified surface envelopes based on target configuration (#2131).
- Add top-level `surface()` and `deleteSurface()` directive support in Express DSL to target or delete UI surfaces (#2163).
- Invoke ANTLR from the grammar's directory when regenerating the Express parser, so generated file headers no longer embed the absolute path of the machine that built them (#2371).
- Stop rewriting the non-package fallback import in the generated Express visitor to a relative import, which pointed at a module name the rename step had already replaced. A from-source build now leaves the working tree clean (#2371).

## 0.5.0

- Rename inference format `Transport` / `transport` terminology to `Direct JSON` / `direct_json` (`DirectJsonFormat`, `DirectJsonParser`, `DirectJsonStreamParser`). Deprecate `a2ui.inference_formats.transport` module alias.
- Cache `A2uiValidator` on `A2uiCatalog.validator` using `functools.cached_property` to avoid redundant construction on every access (#1972).

## 0.4.0

- Standardize Python namespace packages to PEP 420 (#1815). Note: Breaking change removing `a2ui.__version__` from the root `a2ui` namespace level; use `from a2ui.version import __version__`.
- Update required `a2ui-core` dependency to `>=0.1.1,<0.2.0`.

## 0.3.0

- Split `a2ui_core` and `a2ui_agent` into separate packages.

## 0.2.4

## 0.2.3

## 0.2.2

## 0.2.1

## 0.2.0

## 0.1.2

## 0.1.1
