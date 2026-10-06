## Unreleased

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
- Catalogs that inference formats and `A2uiCatalog.core_catalog` take or return are typed `CatalogApi` from `a2ui.core` instead of `Catalog[Any, Any]`.
- Add A2UI Macros API under `a2ui.transformers.macros` (`@macro` decorator and `MacroExpander`), enabling authoring of reusable, high-level composite components using fluent Python builder classes that lower into primitive A2UI component subtrees (`transform_to_transport`) and synthesize inference catalog schemas (`transform_to_inference_catalog`, `to_catalog`) (#2519).
- **BREAKING**: The common types schema is no longer bundled as an asset.
  `A2uiCatalog.from_config` and `DirectJsonFormat` take it from a2ui-core's
  generated schema (`a2ui.schema.utils.load_common_types_schema`), the same
  definitions that payload validation uses.
- Streaming validation errors quote the schema's own pattern (for example
  `\p{XID_Start}`) instead of its expansion for Python's `re` module.
- **BREAKING**: `a2ui.basic_catalog` (`BasicCatalog`, `BundledCatalogProvider`,
  and `BASIC_CATALOG_NAME`) is removed, and the basic catalog JSON files are no
  longer bundled. Use `BasicCatalog` from `a2ui.core.basic_catalog` instead:
  `BasicCatalog.get_config(version)` becomes
  `CatalogConfig.from_catalog("basic", BasicCatalog(version))`.
- Add `CatalogConfig.from_catalog` and `InMemoryCatalogProvider` (exported from
  `a2ui.schema`) to configure a catalog from an `a2ui.core` catalog instance.
- Rebuild `$defs.anyComponent` and `$defs.anyFunction` when merging client
  `inlineCatalogs` in `DirectJsonFormat._select_catalog` (#2115).

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
