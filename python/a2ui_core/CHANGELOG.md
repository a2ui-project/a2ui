## Unreleased

- Under a `ValidationConfig` that allows dangling references, and orphans or a
  missing root, as an agent mirroring a renderer's surfaces uses,
  `MessageProcessor` checks each `updateComponents` against the components it
  changes rather than copying the surface and walking its whole graph. A
  surface that arrives in many small messages now takes time in proportion to
  its size rather than its square. The checks and the errors they raise are
  unchanged: composition constraints, the root when it is required, and
  self-references, cycles and depth. Other configs check the whole surface as
  before.
- `SurfaceComponentsModel.components_update_applied` reports that a batch
  `validate_components_update` passed has been applied, so that the next check
  can start from what that check found. `MessageProcessor` calls it.
- `ComponentModel.get_child_references` and `is_v0_8_heuristic_child_prop_key`
  accept any container of known component ids, not only a set.
- A component property declared directly as an array of component ids
  (`{"type": "array", "items": {"$ref": ".../ComponentId"}}`) rather than as a
  `ChildList` is now read as a list of child references under every
  validation config. Previously it was only read that way when an item named
  a component the surface already held, so a strict config now reports an
  item naming a missing component as a dangling reference, and error paths
  read `name[i]` instead of `name.[i]`.

## 0.4.0 (2026-10-17)

- Catalogs can reference components, property schemas and functions in peer
  catalogs with external `$ref`s such as
  `simplified_catalog_v1_0.json#/components/Text`. `Catalog.peer_catalogs`
  lists the peers a catalog resolves them against.
  `Catalog.with_peer_catalogs(peers)` returns a new catalog linked to `peers`
  and leaves the catalog it is called on unchanged. `link_catalogs` returns
  the catalogs linked to one another, with optional `extra_peers`: a catalog
  without cross-catalog references is returned as is, and the others are
  replaced by linked copies. `inline_local_refs` takes an optional `peers`
  argument. A reference names its peer by `catalogId` or `$id`, exactly or by
  path suffix, before falling back to the file name. `common_types.json` and a
  document named exactly `catalog.json` are never peers, and a path ending in
  `/catalog.json` that names no peer refers to the catalog itself.
  `MessageProcessor` links copies of the catalogs passed to it and never
  modifies them, so shared catalogs such as the basic catalog stay unchanged.
- `is_valid_uax31_identifier` and `assert_uax31_identifier` no longer strip a
  leading `@` before checking UAX 31 syntax, and `Catalog.from_json` now rejects
  `@`-prefixed catalog function names and validates function parameter names.
  `PayloadValidator` allows the reserved `@index` system function call on v1.0+
  surfaces while validating user-defined function names against UAX 31.
- **BREAKING**: `a2ui.core.schema.AgentToRendererMessage`,
  `RendererToAgentMessage`, and their legacy aliases now expose the full
  v0.8–v1.0 union instead of being overwritten by v0.9 re-exports. The facade
  no longer re-exports `AGENT_TO_RENDERER_DEFS`, `INLINE_DEF_MARKER`,
  `SchemaKeywords`, `def_ref` or `Annotated`, which leaked through the old
  star imports; import them from their defining modules (#3064).
- **BREAKING**: `Catalog.from_json` keeps each component's and function's
  definition as the document writes it and no longer writes local references
  inline, so `ComponentApi.schema` and `FunctionApi.schema` of a loaded
  catalog may contain `$ref` and `allOf`. To migrate, read
  `Catalog.resolved_component_schema(name)`, `resolved_function_schema(name)`
  and `resolved_theme_schema`, which give the schemas with references
  resolved (#3053).
- `Catalog.from_json` deserializes a catalog document into the catalog model,
  and `Catalog.to_json()` serializes the model back into an unbundled catalog
  document, so `Catalog.from_json(document).to_json()` equals `document`
  (ignoring key order and the order of `enum` and `required`, and excluding
  components and functions omitted from `anyComponent.oneOf` and
  `anyFunction.oneOf`, which `from_json` filters out). No authored JSON is
  cached beside the model:
  - Each component's and function's `schema` is its definition as the
    document writes it, with `allOf` mixins, local `#/$defs/...` and
    `common_types.json#/$defs/...` references, descriptions, closure keywords,
    `allowedParents`/`allowedChildren` and the function's `returnType`,
    `allowedCallers` and `requiresUserActivation`. The resolved schemas are
    computed once per catalog, and `validation_schema`, `PayloadValidator`
    and the component reference map use them.
  - `FunctionApi.is_definition` says whether a function's `schema` is its
    whole catalog document entry rather than the schema of its `args`.
    `from_json` sets it on every function it loads, so `to_json()` writes
    each entry as it was loaded, whatever its shape or name; for a function
    defined in code it defaults to None, which infers it from the schema.
  - `ComponentApi.from_document` and `FunctionApi.from_document` mark entries
    loaded by `from_json`. `to_json()` writes loaded entries, defs and themes
    with their references as written, and points a local reference to a
    common type at `common_types_uri` only in those defined in code. A list
    of `functions` that repeats a `name` raises `A2uiCatalogError`.
  - The catalog keeps the document's top-level fields as attributes:
    `schema_dialect` (`$schema`), `schema_id` (`$id`), `title`,
    `description`, `declared_protocol_version`, `declares_catalog_id`,
    `instructions`, `theme_schema` with its `theme_location` (top-level
    `theme`, v0.8's `styles`, or `$defs.theme`), the shared named `defs`,
    `functions_form` (map or list), `union_defs` and the unknown top-level
    `extras`.
  - `to_json()` assembles the document from those fields. An `anyComponent`
    or `anyFunction` union that lists the entries is derived from them, so a
    transformed catalog lists its own entries; any other union is kept as
    written. A component or function defined by a model is derived from the
    model in the shape of its protocol version, and `common_types_uri` names
    the document its common types references point into. A catalog defined in
    code emits a canonical `protocolVersion` and the unions of its entries;
    an empty union is `{"not": {}}`; a union written as `null` is kept.
    `to_json()` and `validation_schema` are computed once per catalog and
    return a new copy on each call, so a catalog must be treated as immutable
    once built: later changes to its fields are not reflected, and `copy_with`
    derives a changed catalog (#3053).
- The basic catalogs (`a2ui.core.basic_catalog.v0_8`, `v0_9` and `v1_0`)
  rebuild their published catalog documents from their generated models, so
  `BasicCatalog().to_json()` equals the published file without reading it;
  `a2ui-core` ships no catalog JSON. The generated `BasicCatalog` passes the
  document's top-level fields to `Catalog` and its theme as `theme_model`.
  Their `validation_schema` is unchanged except that the v1.0 catalog emits
  the `protocolVersion: "1.0"` its document declares (#3053).
- **BREAKING**: (v0_8) The generated basic catalog models no longer share one
  model between nested objects of different shapes: `CheckBox.value` keeps
  `literalBoolean` (`ValueItem`), and `DateTimeInput.value`, `Slider.value`
  and a `Button` action's context `value` get their own models
  (`DateTimeInputValueItem`, `SliderValueItem`, `ContextValueItem`), so values
  the specification allows are no longer rejected. Nested object models carry
  their descriptions on the fields, with line breaks kept, rather than as
  docstrings. To migrate, build those values with the new models instead of
  `ValueItem` (#3053).
- `Catalog.from_json` reads a v0.8 document's top-level `styles` as the theme
  schema (#3053).
- `Catalog.validation_schema` is the self-contained schema used to validate
  messages, previously `catalog_schema`. `catalog_schema` remains as a
  deprecated alias that emits a `DeprecationWarning`; to migrate, read
  `validation_schema` instead (#3053).
- `Catalog.validation_schema` emits the `protocolVersion` that the catalog
  document declares (including the canonical version of a catalog defined in
  code), in the bare semantic version form that
  `catalog_definition.json` requires (`v0.9.1` becomes `0.9.1`; `to_json`
  keeps it as written). Before v1.0, each function call schema in it
  has the specification's shape: a `returnType` constant, `args` required when
  it has required arguments, and `unevaluatedProperties: false` on the call
  and on its `args` unless the document already decides on unlisted
  properties. v1.0 function entries stay open, since `FunctionCall` closes the
  call (#3053).
- `Catalog.validation_schema` bundles the published common types defs, with
  local references, for every catalog, including catalogs loaded with
  `Catalog.from_json`, which previously got the flat model-derived defs. It
  flattens `allOf` mixins (`ComponentCommon`, `Checkable`, and local `#/$defs/`
  mixins) into flat component `properties` and `required` lists with component
  properties overriding mixin properties, strips envelope keys (`id`,
  `component`, `catalogId`) before reconstructing the canonical component
  envelope, prunes `ComponentCommon`, `Checkable` and inlined local mixins from
  `$defs`, and propagates `$ref` target descriptions onto reference objects. A
  catalog without functions gets `anyFunction: {"not": {}}`, so the bundled
  `FunctionCall` admits no catalog function call. From v0.9, a theme
  object schema that does not decide on unlisted properties gets
  `additionalProperties: true`. A `title` keyword written in a catalog document
  is kept instead of being stripped (#3036, #3053).
- `Catalog.from_json` reads a v0.9 function's return type from its
  `returnType` constant, so `FunctionApi.return_type` is no longer `any` for
  the published v0.9 basic catalog's functions (#3053).
- `Catalog.copy_with(components=, functions=, defs=)` returns a copy that
  keeps the document fields, lists its own entries in the unions it derives,
  and drops the authored definitions that only the dropped entries
  referenced (#3053).
- `Catalog.from_json` sets a function's `description` from its definition
  (#3053).
- `Catalog.from_json` no longer raises when neither the document nor the
  `protocol_version` argument names a protocol version; the catalog defaults
  to v0.9 (#3053).
- **BREAKING**: From v1.0, `MessageProcessor.get_renderer_capabilities`
  builds `inlineCatalogs` from `Catalog.to_json()` instead of the bundled
  schema, matching the v1.0 `catalog_definition.json` shape, so an inline
  catalog keeps its external `common_types.json` references (#3053).
- **BREAKING** (v1_0): Components and function calls that name no
  `catalogId` resolve against the surface's default catalog, and fail if the
  surface has none, instead of falling back to the first registered catalog.
  An updated component no longer keeps the catalog of its previous version.
- **BREAKING** (v1_0): `MessageProcessor` checks each nested function call
  against the catalog it resolves to, and a call whose catalog can't be
  resolved raises `A2uiCatalogError`, as a component does, even without a
  validation config. Argument errors from these checks are reported together
  with the component schema errors of the same update, in one
  `A2uiValidationError`, which reports a detail found by both checks once.
- (v1_0) `PayloadValidator` fully checks a nested call when it runs in the
  validator's catalog: when it names that catalog, or names no `catalogId` in
  a component that names none either. Any other call runs in a catalog the
  validator can't see, so only its envelope is checked: function and argument
  identifiers, and `args` must be an object; `MessageProcessor` checks it against the catalog it resolves to.
  `SurfaceComponentsModel.validate_components_update` applies the same rule,
  using whether each component's catalog is the surface default. Nested calls
  are checked even in a component whose type the catalog doesn't define and
  the validation config allows (`allow_unknown_elements`).
- **BREAKING**: `DataContext.is_v10` is renamed to `DataContext.at_least_v10`, since it is true for v1.0 and every later version.
- **BREAKING**: `DataContext` reports a function call whose catalog can't be resolved on the surface error channel with code `CATALOG_ERROR` instead of `EXPRESSION_ERROR`. Other evaluation failures, including a function missing from its resolved catalog, keep `EXPRESSION_ERROR`.
- (v1_0) `MessageProcessor` rejects a component whose `catalogId` is not a string with `A2uiValidationError`, as it does for a function call, instead of failing to find the catalog.
- **BREAKING**: `ComponentModel` requires a catalog:
  `ComponentModel(component_id, component_type, catalog, properties=None)`.
  The legacy `ComponentModel(id, type, properties)` form and a `None` catalog
  are no longer accepted. `MessageProcessor` raises `A2uiCatalogError` before
  creating a model when neither the component nor the surface names a
  catalog.
- (v1_0) A component's JSON schema no longer judges the function or args of a
  nested call: the published `FunctionCall` def, which ties every call to the
  functions of the component's catalog, is replaced by its envelope (`@call`,
  `args`, `catalogId`) during component validation. So a JSON catalog built
  from the generated or published basic schema accepts a call that names
  another catalog, and the call is judged by the nested-call checks above
  instead. Nested-call errors are now reported at the call's location in the
  component (for example `components.t1.text.args.value`) rather than as
  `functions.<name>...`, without a second, vaguer schema error for the same
  call.
- (v1_0) An empty `catalogId` names a catalog, as any string does, so a
  component or function call with `catalogId: ""` fails catalog resolution
  instead of falling back to the surface default, and a direct
  `PayloadValidator` treats it as another catalog. A non-string `catalogId`
  on a nested call is a `type_mismatch` error.
- (v1_0) Reserved `@` system functions such as `@index` need no catalog: they
  are validated and run without catalog resolution, on any surface. A system
  function call that names a `catalogId` is rejected (`extra_field`), and
  `DataContext` reports it as an `EXPRESSION_ERROR` instead of running it.
- (v1_0) A nested call with an empty `@call` name is rejected as an invalid
  identifier instead of being skipped.
- (v1_0) `catalogId` and `metadata` are component envelope keys, like `id` and
  `component`: `PayloadValidator` leaves them out when a component's JSON
  schema or Pydantic model doesn't declare them, so a closed schema accepts a
  component that names its catalog. A `catalogId` left out this way must
  still be a string.
- **BREAKING** (v1_0): Every component in `updateComponents` must name its
  `component` type, as the specification requires; an update of an existing
  component that leaves it out is rejected.
- (v0_9) A function call's `catalogId` is ignored, since v0.9 function calls
  have no such field, so the call always runs in the surface catalog.
  Previously a call naming a catalog the surface lacked raised
  `A2uiCatalogError`. `PayloadValidator` likewise checks such a call against
  its catalog instead of only checking its identifiers.
- **BREAKING**: `SurfaceModel.default_catalog` and `SurfaceModel.catalog` are
  now `CatalogApi | None`, since a v1.0 surface may have no default catalog.
  New `SurfaceModel.protocol_version` holds the surface's version.
- New `SurfaceModel.resolve_catalog`, which resolves the catalog a component
  or function call runs in. New `validate_system_function`
  (`a2ui.core.validation`) and `is_system_function_name` (`a2ui.core.catalog`).

## 0.3.0 (2026-10-08)

- `inline_local_refs` is exported from `a2ui.core`. It writes a schema's local
  `#/` references inline, keeping references to common types, as
  `Catalog.from_json` does
  ([#2966](https://github.com/a2ui-project/a2ui/pull/2966)).
- (v1_0) The basic catalog's `and`, `or` and `not` read a ValidationResult
  operand by its `valid` member instead of treating every non-empty dict as
  truthy, so the v1.0 specification's nested
  `and(required, or(required, required))` check is false when a field is
  empty. The v0.9 catalog keeps plain truthiness, since its validators return
  booleans.
- **BREAKING**: `DataContext` validates a function call's arguments as
  written, before resolving the bindings and nested calls in them, and passes
  the resolved values to the function body without validating them again.
  The catalog's argument schema describes the written shape (a
  `DynamicBoolean` admits a `{"@call": ...}`), so validating the resolved
  values rejected, for example, the ValidationResult a v1.0 validator returns
  to `and`, `or` or `not`. This matches web_core. Accordingly,
  `FunctionImplementation.execute` no longer validates its arguments; callers
  that invoke it directly validate the written arguments first, with
  `PayloadValidator.validate_function` or the function's schema model.
- **BREAKING**: `ComponentModel.component_tree` names the component under
  `component`, as an `updateComponents` message does, instead of `type`. A
  property named `type` no longer replaces the component type in the tree,
  and is kept. `ComponentModel.validate` validates that same dict, so a
  property named `component` or `id` no longer replaces the model's own
  during validation ([#2930](https://github.com/a2ui-project/a2ui/pull/2930)).
- The path syntax and function call depth checks in
  `validate_recursion_and_paths` also read v1.0's `@path` and `@call`. A v1.0
  payload with a malformed `@path`, or with `@call` expressions nested deeper
  than the limit, used to pass validation
  ([#3013](https://github.com/a2ui-project/a2ui/pull/3013)).
- JSON Schema patterns are validated with `regex` (`SchemaValidator` in
  `a2ui.core.validation`), supporting Unicode property escapes such as
  `\p{XID_Start}` and `\p{XID_Continue}` natively and anchoring `$` to the end
  of the string per ECMA-262. `clean_schema_node` leaves `const`, `enum`,
  `default`, and `examples` values untouched.
- `PayloadValidator` reports invalid `Extensions` keys even with
  `allow_unknown_elements`.
- Catalog schemas reference `DynamicStringList` for string list values, as the
  basic catalog does, instead of `DynamicValue`.
- Patch and pre-release protocol versions use the common types of their release
  line (`1.0.0-rc.1` uses v1.0). Unparsable versions raise `A2uiCatalogError`
  when a catalog schema is built.
- `GenericBinder` binds `$ref`s to catalog-defined dynamic defs (for example
  `DynamicDate`).
- Add `CatalogApi`, the name for a schema-only `Catalog[ComponentApi, FunctionApi]`, exported from `a2ui.core`. `Catalog.from_json` returns it.
- Execute `functionCall` and `call` component actions locally in `GenericBinder` and prevent `SurfaceModel.dispatch_action` from emitting them as agent-facing `on_action` events.
- `ExpressionParser` accepts number literals with a leading decimal point
  (`.5`, `-.5`, `+.5`, `.5e2`), including as function-call arguments. `.foo`
  and `./x` are still paths.
- `ExpressionParser` raises `A2uiExpressionError` for a number literal outside
  the double range, such as `1e999` or a 400-digit integer. It used to return
  `inf` for float literals and an exact `int` for integer literals. Integer
  literals longer than 4,300 digits no longer raise a bare `ValueError`.
- **BREAKING**: Optional JSON Schema `default` annotations in generated v0.9
  and v1.0 Pydantic models are kept in field descriptions instead of becoming
  field values. `const` values remain fixed.
- **BREAKING**: `BasicCatalog` from `a2ui.core.basic_catalog` is a factory that
  returns the basic catalog of a protocol version, for example
  `BasicCatalog("0.9")`. The package no longer re-exports the v0.9 basic
  catalog's symbols; import them from `a2ui.core.basic_catalog.v0_9`.
- The v0.8 basic catalog's `catalog_id` is the v0.8 standard catalog ID,
  `https://a2ui.org/specification/v0_8/standard_catalog_definition.json`.
- **BREAKING**: `PayloadValidator`, `SurfaceModel`, `SurfaceGroupModel`,
  `DataContext`, and `RpcHandler` are no longer generic. They take `CatalogApi`
  catalogs, so remove type arguments such as
  `SurfaceModel[MyComponent, MyFunction]`.

## 0.2.0 (2026-09-28)

- **BREAKING**: Module paths and validation interfaces moved or changed in v0.2.0. Deprecation shims are provided for renamed public module paths; importing them emits a `DeprecationWarning` naming the new path. These shims will be removed in `v0.3.0`.

  **Shimmed Modules (Deprecated; removal in v0.3.0):**

  | Old Path (`v0.1.x`)                                                                  | New Path (`v0.2.0`)                                                                       | Notes                                                |
  | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------------------------- |
  | `a2ui.core.basic_catalog.{components,function_apis,function_impls,styles}`           | `a2ui.core.basic_catalog.v0_9.{components,function_apis,function_impls,styles}`           | Re-exports v0.9 basic catalog symbols                |
  | `a2ui.core.basic_catalog.expression_parser`                                          | `a2ui.core.expressions.expression_parser`                                                 | Re-exports `ExpressionParser`, `Scanner`, and limits |
  | `a2ui.core.schema.{client_capabilities,client_to_server,constants,server_to_client}` | `a2ui.core.schema.v0_9.{client_capabilities,client_to_server,constants,server_to_client}` | Also aliases `A2uiClientError*` and `SPEC_VERSION*`  |

  **Unshimmed Internal Modules & Renames:**

  Internal modules were moved without shims; callers should import from the new paths directly:

  - `a2ui.core.rendering` (and `.component_context`, `.data_context`, `.generic_binder`): moved to `a2ui.core.resolution` (and matching submodules).
  - `a2ui.core.validating` (and `.integrity_checker`, `.topology_analyzer`): moved to `a2ui.core.validation` (and `a2ui.core.state.validation_helpers`).
  - `validate_component_integrity`: moved to `a2ui.core.validation` as `(components: dict[str, ComponentModel], root_id: str = ROOT_ID, config: ValidationConfig | None = None) -> None`.
  - `analyze_topology`: moved to `a2ui.core.validation` as `(components: dict[str, ComponentModel], root_id: str = ROOT_ID, config: ValidationConfig | None = None) -> set[str]`.

  **Removed Modules and APIs:**

  | Removed (`v0.1.x`)                                                                               | Replacement (`v0.2.0`)                                                             |
  | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
  | `a2ui.core.validating.validator` (`A2uiValidator`, `A2uiValidatorError`)                         | `a2ui.core.validation.PayloadValidator`                                            |
  | `a2ui.core.validating.catalog_schema_validator` (`CatalogSchemaValidator`, `extract_ref_fields`) | `a2ui.core.catalog.reference_map` (`ComponentRefSpec`, `build_component_ref_map`)  |
  | `a2ui.core.validating.integrity_checker.get_component_references`                                | `ComponentRefSpec.extract_child_references`, `ComponentModel.get_child_references` |
  | `a2ui.core.state.{node_graph,component_node}` (`NodeGraph`, `ComponentNode`)                     | Removed                                                                            |
  | `a2ui.core.basic_catalog.locale_config`                                                          | `a2ui.core.basic_catalog.locale_formatting` (Babel/CLDR)                           |
  | `a2ui.core.basic_catalog.operator_apis`                                                          | `a2ui.core.basic_catalog.v1_0.operator_apis`                                       |
  | `get_client_capabilities`, `get_client_data_model`                                               | Removed                                                                            |
  | `SPEC_VERSION`                                                                                   | `PROTOCOL_VERSION` (in `a2ui.core.schema.v0_9.constants`)                          |
  | `A2uiClientErrorMessage`                                                                         | `A2uiRendererErrorMessage`                                                         |
  | `Catalog(spec_version=)`                                                                         | `Catalog(protocol_version=)`                                                       |
  | `MessageProcessor(strict_mode=)`                                                                 | `MessageProcessor(options=)`                                                       |

- **BREAKING**: `DataModel` stores data values by reference instead of making deep copies. Callers that mutate nested objects after setting them in `DataModel` will update internal state directly.
- **BREAKING**: `A2uiRpcError` argument order is now `(message, code, ...)`.
- **BREAKING**: `DataModel.set` now raises `A2uiDataError` instead of resetting the root when attempting to traverse or set a subpath under a primitive root value.
- **BREAKING**: `SurfaceComponentsModel.add_component` now raises `A2uiStateError` if a component with the same ID already exists in the model.
- **BREAKING**: pending RPC requests on `RpcHandler.dispose()` are now rejected with error code `CANCELLED` (previously `DISPOSED`).
- `SurfaceModel` now accepts a `root_id` parameter (defaulting to `"root"`) and provides a deprecated `catalog` property aliasing `default_catalog`.
- `SurfaceComponentsModel.detect_cycles` now correctly ignores disconnected orphan components by passing `allow_orphan_components=True` to topology analysis, reporting cycle and depth limit violations exclusively.
- Bound function calls to `MAX_FUNCTION_CALL_ARGS` (1,000 arguments) across both `PayloadValidator.validate_function` and runtime `DataContext._execute_function` resolution.
- Bound expression template strings to `MAX_EXPRESSION_TEMPLATE_LENGTH` (10,000 characters) and parsed expression segments to `MAX_EXPRESSION_PARTS` (1,000 parts) in `ExpressionParser`.
- Add SemVer parsing and comparison utilities (`SemVer`, `compare_semver`, `is_at_least_version`, `normalize_version_string`, `parse_semver`, `to_canonical_version`, `to_semver`) in `a2ui.core.common.semver`.
- Add `A2uiProtocolVersion` and `ProtocolVersion` enum in `a2ui.core.schema`.
- Remove `A2uiCompileError` from `a2ui_core` exception hierarchy.
- **BREAKING**: locale formatting now comes from CLDR by way of `babel`,
  replacing the hand-rolled locale tables. Currency, number, date month and
  weekday names, and plural category selection now match what the TypeScript
  engine gets from `Intl`. That was the point: the two engines previously
  disagreed for every locale other than `en-US`, on the symbol chosen and on
  which Unicode space separates it from the amount.

  `a2ui.core.basic_catalog` no longer exports `LocaleFormattingRules`,
  `register_locale_rules`, `get_locale_rules` or `CURRENCY_SYMBOLS`, and
  `locale_config.py` is deleted. `register_locale_rules` was the extension
  point for registering a custom locale; that capability goes away rather than
  moving, because `babel` resolves locales from CLDR only.

  `babel` is added as a runtime dependency.

  `babel` reads its patterns and symbols from CLDR but does not implement
  CLDR's `currencySpacing`, which ICU does apply. The package supplies that
  rule itself, so a currency whose symbol is alphabetic is separated from the
  amount by U+00A0 as `Intl` separates it: `CHF 1,234.56`, not `CHF1,234.56`.
  This affects the assigned codes `CHF`, `SEK`, `DKK`, `CZK` and `PLN` among
  others, in `en-US` as well as elsewhere.

  One difference from `Intl` remains. For Arabic locales such as `ar-EG`,
  `Intl` shapes digits in Eastern Arabic numerals while `babel` emits Latin
  ones. `babel` offers no way to close this: requesting the locale's default
  numbering system converts the separators but not the digits, which agrees
  with neither engine.

  A locale tag the catalog cannot use falls back to `en_US` rather than
  raising. `babel` raises for a malformed tag and for a well-formed tag CLDR
  does not carry, such as `xx-YY`, either of which would otherwise abort every
  format call made by a catalog built with it. The TypeScript engine falls back
  for the same tags.

- **BREAKING**: the `Dynamic*` schema aliases no longer coerce a value of the
  wrong primitive type. Each admits one primitive type, a data binding, or a
  function call, matching the TypeScript engine and the specification. What
  changes in practice:
  - `DynamicNumber` rejects the string `"1"`, which previously validated as
    `1.0`, and rejects `True`, which previously validated as `1`.
  - `DynamicBoolean` rejects `1`, `0` and `"true"`, which previously validated
    as `True`, `False` and `True`.
  - `DynamicValue` keeps an integer as an integer. It admitted `float` but not
    `int`, so a payload carrying `1` came back as `1.0`.
  - `DynamicString` and `DynamicStringList` are now declared strict for
    consistency. This is not a behaviour change: pydantic already refused to
    coerce other primitives into a string.

  Data bindings and function calls are unaffected.

- The v0.9 and v1.0 basic catalogs no longer register `add`, `subtract`, `multiply`,
  `divide`, `equals`, `not_equals`, `greater_than`, `less_than`, `contains`,
  `starts_with` or `ends_with`. The published catalogs declare exactly 14
  functions, and none of these operators is among them, so an agent had no way to know
  they were callable. `a2ui.core.basic_catalog` no longer exports their
  API classes or implementations, aligning Python engine behavior with the
  reference typescript implementation.

- The v1.0 `formatDate` `ISO` pattern now returns the UTC instant with exactly
  three fractional digits, as `web_core` does. It previously echoed back
  whichever offset the input carried, so `2025-01-01T12:00:00+02:00` formatted
  as itself instead of `2025-01-01T10:00:00.000Z`. A timestamp without an
  offset is read as UTC, so the result no longer depends on the host time zone.

- The v1.0 `pluralize` function now falls back to the `other` form only when
  the selected category is absent, not when its value is empty. A caller that
  supplies `zero: ""` gets an empty string, matching `web_core`; previously the
  empty form was discarded and the `other` form rendered in its place.

- `ExpressionParser.MAX_DEPTH` is 100, up from 10, matching `web_core` and the
  Swift engine. An expression nested between 11 and 100 levels deep was
  rejected here and accepted there.

- A function-call argument now counts toward the expression parser's recursion
  depth, as it does in `web_core`. Only nested interpolations were counted
  before, so `${f(a: ${f(a: ...)})}` written as `${f(a: f(a: ...))}` recursed
  unchecked and raised `RecursionError` from the interpreter rather than a
  parse error.

- `Catalog.from_json` accepts a `common_types_schema` argument and rewrites
  cross-document references such as `common_types.json#/$defs/ChildList` into
  local `#/$defs/...` pointers, satisfying them from the supplied document or
  from the built-in definitions. Catalogs that reference the published shared
  types now load without the `specification/` tree on disk, and the validator
  no longer reads schema files at runtime.
- Deleting a list index past the end of the list is now a no-op. It previously
  padded the list with `None` up to that index, so deleting `/items/10` from a
  three-element list produced an eleven-element list.
- The shared type definitions used to satisfy `common_types.json` references
  are now checked against the published document by a test, with an explicit
  list of the definitions that intentionally differ. Descriptions on
  `AccessibilityAttributes`, `DynamicString`, `DynamicNumber` and
  `DynamicBoolean` were brought back into line with the specification.
- The conformance harness now fails, rather than silently skipping, when a
  suite cannot be parsed, when a case has no `name` or `action`, or when an
  action has no handler. Suites the core library cannot run are named in
  `UNRUNNABLE_SUITES` with a reason.
- Move `@index` (`IndexApi`, `IndexArgs`, `IndexImplementation`) from
  `a2ui.core.basic_catalog.v1_0` (`v1_0/operator_apis.py` removed) to
  `a2ui.core.catalog`, where `system_functions_for` supplies it to v1.0 and
  later catalogs.

## 0.1.1

- Enable type checks across `a2ui_core` (#1816).
- Fix `MessageProcessor.get_client_capabilities` exporting `None` into `inlineCatalogs` for programmatically created catalogs.
- Optimize component validation with cached Pydantic `TypeAdapter` on `ComponentImplementation`.

## 0.1.0

- Initial standalone release of `a2ui_core` (split from `a2ui_agent`).

## 0.0.4

## 0.0.3

## 0.0.1
