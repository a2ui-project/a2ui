---
codebase_path: typescript/core/web_core
associated_module: a2ui_core
module_blueprint_commit: 9055207b827a471bc64cd6e247ee22c5d675cbfb
implemented_features:
  agent_functions: 87b945802660c507bc84f7f47a25199b4939efbe
  agent_renderer_app: 5f2245c530f72fbdd25002b0fe3f252595b1c4c3
  node_resolution: 24d1bf9c830071f74c9c908433e73cc6cbe0aa33
  universal_custom_elements: 0d70f4407f3defb78f1fa5646868341536b7a29b
local_development:
  test_command: 'yarn test'
  lint_command: 'yarn lint'
  format_command: 'yarn format'
---

# **Web Core Codebase Blueprint**

## **Architecture & Ecosystem Map**

This is the reference TypeScript implementation of the A2UI Core State Layer (`a2ui_core`).

- **Reactivity & Signaling**: Powered by `@preact/signals-core` (`Signal`, `ReadonlySignal`, `computed`, `effect`, `batch`) paired with `EventSource<T>`, `EventNotifier<T>`, and `Subscription` for discrete lifecycle events under `src/reactivity/` and `src/events/`.
- **Validation & Parsing**: Employs `zod` and JSON Schema validation (`src/validation/`) alongside topological graph/composition checks (`SurfaceComponentsModel`) and protocol-versioned processors (`src/processing/`, `src/v0_9/`, `src/v1_0/`). The `regex` function parses its pattern with the shared regular expression subset parser and static safety check (`src/common/regex_subset.ts`) before it compiles it.
- **Resolution & Binding**: `DataContext`, `ComponentContext`, `GenericBinder`, `NodeResolver`, and `ComponentNode` resolve reactive component trees, `ResolvedBinding` values, and check rule evaluations under `src/resolution/`.
- **Extension Metadata**: `SurfaceModel` and `ComponentModel` hold the v1.0 `metadata` envelope (`metadata`, `extensions`, `setExtension`, `removeExtension`, `onMetadataChanged`), and `ComponentNode.metadata` exposes a component's envelope as a signal.
- **Bidirectional RPC & Agent Functions**: `RpcHandler` (`src/rpc/`) runs the agent's `callRendererFunction` calls and sends the renderer's calls to the agent. On a v1.0 surface, a call the resolved catalog cannot run locally goes to the agent through the surface's agent function caller. Settled answers are cached per surface (`maxAgentCallCacheEntries` in `MessageProcessorOptions` and on `SurfaceModel`), and `RpcHandler.cancelSurfaceCalls` cancels a surface's pending calls. `AgentFunction` (`src/catalog/agent_function.ts`) declares a function the agent hosts, added to a `Catalog` with `copyWith({agentFunctions})`.
- **Universal Custom Elements**: `src/universal/` implements `A2uiLitElement`, `A2uiController`, `defineA2uiElement`, and `registerUniversalElement` so Web Component catalogs run across Lit, React, and Angular.

## **Local Technical Decisions & Overrides**

- **Component envelope split**: `src/catalog/component_envelope.ts` holds the shared logic that separates the v1.0 `@catalogId`, `@accessibility`, `@metadata`, and `@checks` envelope keys from catalog properties, using the component schema to tell a custom bare property apart from a legacy bare envelope key. `PayloadValidator`, `MessageProcessor`, the validation helpers, and the schema loader all use it, so they cannot disagree on which keys are envelope. `Catalog.fromJson` does not load `oneOf` or `anyOf` branches nested in a component's `allOf`, so a property declared only in such a branch is missing from the schema the split reads. The conformance case for it (`test_v10_custom_envelope_properties_declared_in_combiner_branches`) is skipped as a known divergence.
- **Unified State & Version Entrypoints**: Shared state and resolution primitives live under `src/{state,processing,resolution,rpc,validation,universal}` while `src/v0_9/` and `src/v1_0/` expose version-specific schemas and subpath barrels.
- **Deprecated `ComponentNode.context`**: Kept for compatibility until the next breaking release; adapters and universal elements do not read it.
- **TypeScript Reflection**: We utilize Zod runtime reflection to implement the automated generic binder layer. This automatically resolves complex properties (such as `DynamicString` or action callbacks) into simple static native types, freeing renderers (React, Angular, Lit) from having to deal with raw subscription loops. `ResolveA2uiProps` mirrors the binder at the type level, inside lists and objects too, and leaves lists of `CheckRule` as they are, as the binder does.
- **Per-call validation config**: `MessageProcessor` reads its `validationConfig` from a field in many private checks, so a config passed in `ExecutionContext` replaces the field for the synchronous part of that call and restores it after. `processMessagesAsync` applies it around each synchronous step.
- **Type coercion scope**: The v1.0 protocol states property and argument coercion for `DynamicBoolean` ("`DynamicBoolean` and `CheckRule` Coercion"). web_core applies it to component properties (`GenericBinder`) and to the arguments of the calls the renderer evaluates (`coerceDynamicBooleans` in `src/catalog/`). The arguments of an agent's `callRendererFunction` are checked by `PayloadValidator.validateFunction` without that coercion. `DynamicString` and `DynamicNumber` properties and arguments pass through as resolved, except that `formatString` coerces its parts to strings and `@index` coerces its `offset` to a number. The module blueprint sentence added in `a641e84f` applies its coercion table to the properties and arguments of all three types, so `module_blueprint_commit` stays at the last commit before it (`9055207b`) until the code or that sentence changes. Of the later module requirements, the regex guard, the `createSurface` data model ordering, the v1.0 `theme` handling, renderer fallback routing, `formatString` catalog inheritance, the `@`-prefixed envelope keys (with the gap noted under the component envelope split), and `MessageProcessor.addCatalog` are implemented.
- **Universal elements without surface fallbacks**: `renderA2uiNode` takes no fallback context and renders nothing for a placeholder node, so the fallbacks for unresolved components that the `universal_custom_elements` feature specifies are not implemented. The feature pin therefore stays at the last commit before that API (`0d70f440`). From the later commits, `accessibilityTarget()`, `renderValidationErrors()`, the host `inert` attribute, and reading `@accessibility` on v1.0 are in place.
- **Agent routing conformance**: web_core re-evaluates a nested call only when its own arguments change. Of the two alternative cancelled-call cases in `conformance/core/agent_function_routing.yaml`, it therefore runs `test_agent_routing_cancelled_call_is_sent_again_when_its_value_is_rewritten`.

## **Validation & Execution Recipes**

- **Test execution**: Run unit and conformance tests using `yarn test`.
- **Linting check**: Ensure style alignment with `yarn lint`.
- **Formatting**: Format the entire directory with `yarn format`.
