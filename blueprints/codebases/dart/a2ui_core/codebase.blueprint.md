---
codebase_path: dart/a2ui_core
associated_module: a2ui_core
module_blueprint_commit: null
implemented_features: []
local_development:
  test_command: 'dart test'
  lint_command: 'dart analyze --fatal-infos'
  format_command: 'dart format .'
---

# **Dart Core Codebase Blueprint**

## **Architecture & Ecosystem Map**

The official Dart implementation of the A2UI Core State Layer (`a2ui_core`), shared by Flutter renderers (`a2ui_flutter`) and Dart agent SDKs (`a2ui_agent`).

- **Reactivity & Signaling**: Built on `preact_signals` (`Signal`, `ReadonlySignal`, `computed`, `effect`, `batch`) paired with `EventSource<T>`, `EventNotifier<T>`, and `Subscription` for discrete lifecycle events.
- **Validation & Schema Resolution**: Uses `json_schema_builder` (JSON Schema Draft 2020-12) together with `PayloadValidator`, `ValidationConfig`, `resolveSchemaRefs`, and topological graph/composition checks (`SurfaceComponentsModel`).
- **Resolution & Binding**: `DataContext`, `ComponentContext`, `GenericBinder`, and `NodeResolver` resolve reactive component trees and data bindings under `lib/src/resolution/`.
- **Bidirectional RPC**: `RpcHandler` coordinates v1.0 renderer-to-agent and agent-to-renderer function calls, timeouts, heartbeats, and cancellation under `lib/src/rpc/`.

## **Local Technical Decisions & Overrides**

- **Typed Binding Wrappers in `ComponentNode.props`**: `NodeResolver` wraps dynamic component properties in `ResolvedBinding<T>` (and `WritableBinding<T>` when path-bound) so Flutter widgets can subscribe to individual reactive properties or write back two-way bindings without re-resolving the parent component node.
- **Idiomatic Dart Concurrency Primitives**: Uses `CancellationSignal` (`lib/src/primitives/cancellation.dart`) in place of Web `AbortSignal`, and Dart `Duration` for RPC call and heartbeat timeouts.

## **Validation & Execution Recipes**

- **Test execution**: Run `dart test` to execute unit and conformance test suites.
- **Static analysis**: Run `dart analyze --fatal-infos` to verify zero analyzer errors, warnings, or lints.
- **Formatting**: Format source files with `dart format .`.
