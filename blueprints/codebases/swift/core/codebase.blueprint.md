---
codebase_path: swift/core
associated_module: a2ui_core
module_blueprint_commit: 9055207b827a471bc64cd6e247ee22c5d675cbfb
implemented_features:
  node_resolution: 24d1bf9c830071f74c9c908433e73cc6cbe0aa33
local_development:
  test_command: 'swift test'
  lint_command: 'swift-format lint -r Package.swift swift/core'
  format_command: 'swift-format format -i -r Package.swift swift/core'
---

# **Swift Core Codebase Blueprint**

## **Architecture & Ecosystem Map**

The native Swift processing engine and state model for A2UI.

- **A2UIJSON** (`swift/core/Sources/A2UIJSON`): Decoupled target holding generated v0.9.1 and v1.0
  JSON Schema 2020-12 definitions and remote `$ref` aliases.
- **A2UICore** (`swift/core/Sources/A2UICore`): Stateful engine managing `MessageProcessor`
  (`addCatalog`, per-call `isUserActivated`), `SurfaceViewModel`, `ComponentModel`, `DataModel`,
  `ComponentEnvelope`, `MetadataValidator`, `NodeResolver` / `Node` (`NodeBox`), `RPCHandler`, and
  `AgentCallCache`.
- **BasicCatalog** (`swift/core/Sources/BasicCatalog`): Component schemas, `RegexSubset` ICU
  translation, `PluralizeFunction`, `FormatStringFunction`, and standard Basic Catalog functions.
- **Swift Testing** (`swift/core/Tests/`): Native Swift Testing suites across `A2UICoreTests`,
  `A2UIJSONTests`, `BasicCatalogTests`, and `A2UIConformanceTests`.

## **Local Technical Decisions & Overrides**

- **Target Boundaries**: Separates core protocol parsing from SwiftUI rendering to allow non-UI use
  cases (such as CLI tools or server integrations).
- **Safe Evaluation**: Avoids force-unwrapping (`!`) and forced tries (`try!`) during runtime
  message and expression evaluation (using `try!` only for static bundled schemas and regexes).
  Runtime failures propagate typed `A2UIError`, `FunctionError`, or `RegexSyntaxError` errors or
  provide fallbacks.
- **Derived catalogs and `Catalog`**: `Catalog.derive` takes a new `id`, `DerivedCatalogEntry` lists
  (`.keep`, string literals, or `.add`), and optional `instructions`; a Swift `Catalog` has no
  `$id`, `title`, or `description` fields to drop. Swift has no `CatalogApi`, and `Catalog` omits
  `fromJson` and `toJson` (`AnyCatalog` retains `FunctionImplementation` values); static
  `ComponentAPI.metadata` is emitted verbatim while wire `@metadata` is validated on ingest.
- **Reactivity, node identity, and metadata**: `SurfaceViewModel`, `DataModel`, and
  `SurfaceComponentsModel` publish via Combine, while `Node` wraps an `@MainActor` `Observation`
  `NodeBox` tracking `properties` and `metadata` separately. `NodeResolver` shares one `NodeBox` per
  `(instanceID, basePath)` across referencing parents and duplicate explicit siblings. `Node`
  exposes `id`, `identity`, `dataContextPath`, `scopeKey`, and computed `isValid`,
  `validationErrors`, and `validationResults`, omitting `instanceId`, `componentId`,
  `isPlaceholder`, `disposed`, `impl`, `onDestroyed`, and `addCleanup`.
  `NodeResolutionConformanceTests` leaves `destroyed`, `emissions`, `metadata_emissions`,
  `replaced_nodes`, and `same_nodes` unasserted, and `DataBinding` exposes `set(_:)` on all
  bindings (no-op for literals) rather than a separate `WritableBinding`. `SurfaceViewModel` and
  value-type `ComponentModel` use throwing `setMetadata` and `setExtension` methods, with reactive
  component updates routed through `SurfaceComponentsModel`.
- **Renderer fallback routing**: `MessageProcessor` accepts per-call `isUserActivated` and routes
  unresolved calls using `agentFunctionTimeoutSeconds` while keeping `AgentCallCache` fixed at `256`
  entries and `RPCHandler.disposeAllPendingCalls()` parameterless. Because `DataModel.watch` and
  `NodeResolver` skip unchanged values on equal-value rewrites,
  `AgentFunctionRoutingConformanceTests` skips
  `test_agent_routing_cancelled_call_is_sent_again_when_its_value_is_rewritten` in favor of
  `test_agent_routing_cancelled_call_is_sent_again_on_unrelated_change`.
- **Type coercion scope**: `A2UICore` coerces `DynamicBoolean` properties and renderer-evaluated
  function arguments. Against the property and RPC coercion rules already in `9055207b`,
  `NodeResolver` returns `nil` on `null` `DynamicString` bindings, leaves numeric `String` and
  `null` `DynamicNumber` values as `nil`, and `RPCHandler.handleIncomingCall` validates
  `callRendererFunction` arguments without `DynamicBoolean` coercion. Commit `a641e84f` further
  extends that coercion table to `DynamicString` and `DynamicNumber` function arguments, which
  `DataContext` does not implement, so `module_blueprint_commit` stops at `9055207b`. Later module
  rules for `RegexSubset`, `createSurface` `dataModel` ordering, relaxed v1.0 `theme` dropping,
  `formatString` catalog inheritance, `@`-prefixed envelope keys, and `addCatalog` are implemented.
- **Conformance skips and `MessageProcessor` scope**: `MessageProcessor` keeps `catalogs` private
  and takes no per-call `ValidationConfig` on `process` or `processMessages`, so
  `MessageProcessorConformanceTests` skips the three `test_v10_call_validation_config_*` cases.
  `A2UIConformanceTests` also skips `v0.8` suites, `core/agent_to_renderer.yaml`,
  `common_types_schema`, and `core/adapter_conformance.yaml` (covered in `A2UISwiftUITests`).

## **Validation & Execution Recipes**

- **Test execution**: Run core and conformance tests via `swift test`.
- **Linting check**: Execute `swift-format lint -r Package.swift swift/core`.
- **Formatting**: Auto-format code via `swift-format format -i -r Package.swift swift/core`.
