---
codebase_path: dart/a2ui_core
associated_module: a2ui_core
module_blueprint_commit: 9055207b827a471bc64cd6e247ee22c5d675cbfb
implemented_features:
  agent_functions: 87b945802660c507bc84f7f47a25199b4939efbe
  agent_renderer_app: 21e8df7f8e67619c30682ede25f17f0a9cfa96f8
  node_resolution: 24d1bf9c830071f74c9c908433e73cc6cbe0aa33
local_development:
  test_command: 'dart test'
  lint_command: 'dart analyze --fatal-infos'
  format_command: 'dart format .'
---

# **Dart Core Codebase Blueprint**

## **Architecture & Ecosystem Map**

The official Dart implementation of the A2UI Core State Layer (`a2ui_core`), shared by Flutter renderers (`a2ui_flutter`) and Dart agent SDKs (`a2ui_agent`).

- **Reactivity & Signaling**: Built on `preact_signals` (`Signal`, `ReadonlySignal`, `computed`, `effect`, `batch`) paired with `EventSource<T>`, `EventNotifier<T>`, and `Subscription` for discrete lifecycle events, plus reactive `metadata` (`extensions`, `setExtension`, `removeExtension`, and `onMetadataChanged` on `SurfaceModel` and `ComponentModel`, and a read-only `metadata` signal on `ComponentNode`).
- **Validation & Schema Resolution**: Uses `json_schema_builder` (JSON Schema Draft 2020-12) together with `PayloadValidator`, `ValidationConfig`, `resolveSchemaRefs`, topological graph and composition checks (`SurfaceComponentsModel`), and the shared portable regular expression subset parser and static safety check (`lib/src/primitives/regex_subset.dart`).
- **Resolution & Binding**: `DataContext`, `ComponentContext`, `GenericBinder`, and `NodeResolver` resolve reactive component trees, `ActionDispatchOptions` action callbacks, `DynamicBoolean` coercion, and `formatString` template catalog inheritance under `lib/src/resolution/`.
- **Bidirectional RPC & Catalog Declarations**: `RpcHandler` coordinates v1.0 renderer-to-agent and agent-to-renderer function calls, timeouts, and cancellation under `lib/src/rpc/`, `DataContext` caches settled agent calls per surface up to `maxAgentCallCacheEntries` (`MessageProcessor` and `SurfaceModel`), and `Catalog` models agent-hosted declarations via `AgentFunction`, `AgentFunctionContext`, and `copyWith(agentFunctions:)` under `lib/src/core/catalog.dart`.

## **Local Technical Decisions & Overrides**

- **Typed Binding Wrappers in `ComponentNode.props` and Node Identity**: `NodeResolver` wraps dynamic component properties in `ResolvedBinding<T>` (and `WritableBinding<T>` when path-bound) so Flutter widgets can subscribe to individual reactive properties or write back two-way bindings without re-resolving the parent component node. `ComponentNode` exposes sibling-distinct `instanceId` and `componentId` without a separate document-wide DOM `id` getter, since Flutter keys widget subtrees by `instanceId` or object identity.
- **Catalog ID Storage on `ComponentModel`**: `ComponentModel.catalog` stores the optional `String?` catalog ID (or `null` when using the surface default catalog), resolved through `SurfaceModel.resolveCatalog`, so `ComponentModel` instances can be constructed before attachment to a `SurfaceModel`.
- **Idiomatic Dart Concurrency Primitives**: Uses `CancellationSignal` (`lib/src/primitives/cancellation.dart`) in place of Web `AbortSignal`, and Dart `Duration` for RPC call timeouts.
- **Per-call validation config**: `processMessages` and `processMessagesAsync` take the config of one call as a `validationConfig` named parameter, beside `isUserActivated`, rather than in an execution context object. Validators are cached per catalog, protocol version and `allowUnknownElements`, the only part of the config a validator reads, so a call that passes a new config object reuses the validators already built. `processMessagesAsync` applies the config while it checks and applies each message, not across its waits for function calls.
- **`Catalog.derive` entries**: Dart has no union of a name and an entry short of `Object`, so `derive` takes the names of the entries to keep in `components` and `functions`, and the new entries in `addComponents` and `addFunctions`, which follow the kept ones and replace a kept entry of the same name.
- **Agent function handler signature and catalog typing**: Because Dart function typedefs have fixed arity, `AgentFunctionHandler` always takes two positional parameters (`(Map<String, dynamic> args, AgentFunctionContext context)`) rather than inspecting 1-or-2-argument signatures at runtime. `AgentFunction` subclasses `FunctionApi` rather than `FunctionImplementation`, so `Catalog.copyWith(agentFunctions:)` requires a catalog whose function type parameter accepts `FunctionApi` (`CatalogApi`).
- **Schema-only functions in renderer catalogs**: Renderer catalogs are `Catalog<C, FunctionImplementation>`, so a function the renderer declares but does not implement is a `SchemaOnlyFunction`, a `FunctionImplementation` whose `execute` throws, rather than a bare `FunctionApi` as in TypeScript and Python. The invoker checks its allowed callers, user activation and arguments, then hands the call to the agent fallback routing.
- **Nested values in the binder**: `GenericBinder` resolves actions, bindings and child lists inside lists and objects, as the module blueprint requires. Its props are a `Map<String, dynamic>`, so there are no prop types to follow it.

## **Validation & Execution Recipes**

- **Test execution**: Run `dart test` to execute unit and conformance test suites.
- **Static analysis**: Run `dart analyze --fatal-infos` to verify zero analyzer errors, warnings, or lints.
- **Formatting**: Format source files with `dart format .`.
