---
name: a2ui_framework_adapter
type: module
description: Framework Adapter specification for rendering the Core SDK node tree with a native UI framework.
---

# A2UI Framework Adapter Specification

A [Framework Adapter](../../docs/public/concepts/glossary.md#fw-adapter) renders A2UI surfaces with a native UI framework. It bridges the platform-agnostic [Core SDK](a2ui_core.blueprint.md) to a target UI technology—such as React, Lit, Angular, Flutter, SwiftUI, or AngularDart—translating reactive layout state into platform-native widgets and views.

This specification describes what a framework adapter must build and expose. It is written for a developer implementing an adapter for a new language or UI framework.

---

## 1. Scope & Core Integration

### Protocol versions

The adapter renders the `ComponentNode` tree that Core resolves, so the adapter itself is largely independent of the wire protocol version. Core negotiates the protocol version per message, normalizes check results, and produces the same `ComponentNode` tree for a v0.9 and a v1.0 surface. An adapter renders both through the same code path.

Where v1.0 and v0.9 differ inside framework adapter code (as distinct from catalog implementations, covered in §5), the special cases are:

| Area                          | v1.0 and later                                                                                            | v0.9 compatibility in the adapter                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Catalog `protocolVersion`** | `createCatalog` requires `protocolVersion` (§4.3); Core rejects an unversioned catalog on a v1.0 surface. | A v0.9 catalog declares `protocolVersion: 'v0.9'` (or omits it where Core permits legacy unversioned catalogs).      |
| **Catalogs on a surface**     | A surface may use several catalogs (`defaultCatalog` and `availableCatalogs`); each node carries `impl`.  | Preparing all catalogs in `surface.availableCatalogs` (§4.2) and dispatching via `node.impl` works for v0.9 as well. |

Packaging follows this model: the package root exports the version-agnostic `Surface`, node dispatcher, and implementation factories capable of rendering any surface produced by Core. Legacy entry points (such as `./v0_9`) are provided as compatibility aliases re-exporting the root runtime, while deprecated pre-Node-API implementations (such as `./v0_8`) are isolated under versioned subpaths.

### Integration points with Core

An adapter integrates with the Core SDK at two primary boundaries:

1. **`SurfaceModel`**: The adapter's root entrypoint (`Surface`) takes `SurfaceModel` directly as its sole input. The `SurfaceModel` encapsulates incoming message processing, the live component hierarchy, the surface's catalogs (`defaultCatalog` and `availableCatalogs`), the data model, and the event channels (`onAction`, `onError`, `onWarning`).
2. **The Node API (`NodeResolver` and `ComponentNode`)**: The adapter initializes a `NodeResolver` on the `SurfaceModel`. It never queries raw component dictionaries or evaluates JSON pointers directly. Instead, it observes the living tree of `ComponentNode` instances produced by `NodeResolver`.

```mermaid
graph LR
    subgraph CoreSDK["A2UI Core SDK"]
        SM["SurfaceModel"]
        NR["NodeResolver"]
        CN["ComponentNode (Tree)"]
        SM --> NR
        NR --> CN
    end

    subgraph Adapter["Framework Adapter"]
        S["Surface (Host)"]
        NV["NodeView (Recursive)"]
        CI["ComponentImplementation"]
        S -->|Accepts| SM
        S -->|Initializes| NR
        NV -->|Dispatches| CN
        NV -->|Invokes| CI
    end
```

### What the adapter owns

| Concern                   | Description                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Public surface host       | Root view/widget consuming `SurfaceModel` and rendering `NodeResolver.rootNode`.                                  |
| Component implementations | Framework-specific UI builders registered for catalog component types.                                            |
| Node dispatcher           | Recursive view mapping each `ComponentNode` to its registered implementation (`node.impl`).                       |
| Reactivity bridge         | Mapping core signals to framework-native change notifications.                                                    |
| User input and actions    | Forwarding native events to `WritableBinding.set()` and invoking `NodeAction` closures synchronously on gestures. |
| Accessibility mapping     | Applying resolved `accessibility` attributes and inferred semantics to the platform accessibility API.            |
| Ambient context           | Propagating the surface handle and its catalogs down the view hierarchy.                                          |
| Teardown lifecycle        | Disposing resolvers and subscriptions when views unmount.                                                         |

### What Core owns (Do not reimplement)

- Protocol message parsing, schema validation, and catalog asset loading.
- Catalog resolution for each component and function call: the item's own `catalogId`, then the surface default, then an error. There is no fallback to the catalogs in capabilities. The adapter never reads `catalogId`.
- Data model storage, relative JSON pointer scoping, expressions, and function evaluation, including `@index` and the reserved `@path` / `@call` keys.
- Function execution and RPC: local `functionCall` actions, `callRendererFunction` handling, `callAgentFunction` dispatch, `rendererFunctionResponse` emission, and the `allowedCallers` and `requiresUserActivation` checks.
- Tree topology: parent-child links, template repeaters (`ChildList` expansions), placeholder stand-ins for pending components, cycle detection, and subtree cleanup.
- Composition validation (`allowedParents`, `allowedChildren`, the reserved `Surface` container) and identifier validation (UAX #31).
- Property classification: mapping catalog schemas into dynamic values, actions, child references, and checks, and normalizing check results into `ValidationResult` objects (`isValid`, `validationErrors`, and `validationResults` on `node.props`).

> [!WARNING]
> Adapter views MUST depend strictly on `SurfaceModel` and the Node API (`NodeResolver`, `ComponentNode`), and MUST NOT use `GenericBinder`, `ComponentContext`, or `DataContext` directly. Function implementations still receive a `DataContext` from Core.

---

## 2. Package Structure

```text
<adapter_package>/
├── surface/          # Public Surface view/widget and ambient context providers
├── nodes/            # Recursive node dispatcher and fallback components
├── binding/          # Reactivity bridge and two-way property accessors
└── catalog/          # ComponentImplementation interface, catalog types, and factories
    └── basic/        # Basic Catalog native component implementations
```

`catalog/basic/` must remain cleanly decoupled from `surface/` and `nodes/`. Applications often substitute their own design system components for basic elements (e.g. replacing basic `Button` with an internal UI library button), so core rendering mechanics must never hardcode dependencies on the built-in basic catalog.

Web adapters that share element implementations across frameworks follow the [universal custom elements feature blueprint](../features/universal_custom_elements.blueprint.md), which adds a shared element layer to this layout.

---

## 3. Consuming the Node API

The adapter consumes `NodeResolver`, `ComponentNode`, `ResolvedBinding`, `WritableBinding`, and `NodeAction` as defined in the [node resolution feature blueprint](../features/node_resolution.blueprint.md). Core resolves bindings, child references, actions, and normalized check properties (`isValid`, `validationErrors`, `validationResults`) onto `node.props` before the adapter sees them, and stores envelope `metadata` on `ComponentModel.metadata` (which views ignore unless forwarding it to developer tooling).

On the adapter side, two cross-cutting rules apply when rendering nodes:

### Actions, user activation, and asynchronous bindings

A `NodeAction` resolves its payload when invoked. For an `event` payload, Core dispatches one action to the agent. For a `functionCall` payload, Core runs the function locally and dispatches nothing. Because a function marked `requiresUserActivation` (such as `openUrl`) runs only while the platform reports an active user gesture, the adapter and its component implementations:

- invoke the `NodeAction` synchronously inside the native gesture handler, with no debounce, defer, or re-dispatch through an asynchronous scheduler;
- do not inspect, cache, or pre-resolve the action payload;
- may show a pending state while a returned future is unsettled. Failures reach the agent through the surface's error channel; the view needs no error handling of its own.

When a dynamic value or check depends on a function that runs asynchronously, a view treats a binding whose value is not yet available like any other empty value and re-renders when `node.props` emits.

### Accessibility

Every component at v1.0 or later may carry `accessibility.label`, `accessibility.description`, `accessibility.live`, and `accessibility.hidden`. `label`, `description`, and `hidden` are dynamic, so they arrive resolved like any other binding. The [protocol](../../specification/v1_0/docs/a2ui_protocol.md#catalog-agnostic-accessibility-requirements) requires every renderer to:

- map the four attributes to the platform's accessibility API (web: `aria-label`, `aria-description`, `aria-live`, `aria-hidden`; Flutter: `Semantics`; iOS: `accessibilityLabel` and friends);
- infer defaults from visible text (a button's child text, a field's label) and let an explicit `accessibility` value override the inferred one.

The mapping belongs in one place per adapter, such as the node dispatcher or a base class every implementation extends, so that custom implementations get it without extra work. The adapter does not validate the attributes; Core already has.

---

## 4. Public APIs

A framework adapter exposes three categories of public APIs:

### 4.1 Surface

The root framework view or widget embedded into the host application.

**Key Requirement:** `Surface` directly accepts `SurfaceModel` from the Core SDK as its sole input. Because `SurfaceModel` already contains the component catalogs, component state graph, data model, and action/error event channels, `Surface` does not need any additional props.

```typescript
// Generic API Sketch
interface SurfaceProps {
  /** The living Core SDK surface model managing state, catalogs, and messages. */
  surface: SurfaceModel;
}
```

```dart
// Flutter Sketch
class A2uiSurface extends StatefulWidget {
  final SurfaceModel surface;

  const A2uiSurface({
    super.key,
    required this.surface,
  });
}
```

#### Responsibilities & Behavior:

1. **Resolver Lifecycle**: Instantiates and retains a `NodeResolver` for the surface for the lifetime of the view. If the `surface` prop changes identity, disposes the old resolver and creates a new one. Disposes the resolver when the view unmounts.
2. **Root Observation**: Observes `nodeResolver.rootNode`. While `rootNode` is empty, renders a framework-appropriate loading placeholder. Once `rootNode` resolves, renders the root `NodeView`.
3. **Ambient Context Injection**: Publishes the surface instance (which exposes the surface's catalogs and event dispatchers) and any host services implementations need, such as a markdown renderer, into the framework's ambient DI/context mechanism (React Context, Flutter `InheritedWidget`, SwiftUI `Environment`, Angular DI).
4. **Rendering only**: `Surface` does not process messages, negotiate capabilities, or execute RPC. Those belong to the Core SDK's `MessageProcessor`.

---

### 4.2 ComponentImplementation

`ComponentImplementation` is the most important framework-specific contract. It pairs a component's schema and type name with the framework-native rendering function.

```typescript
// Generic Contract
interface ComponentImplementation extends ComponentApi {
  readonly name: string;
  readonly schema: Schema;
  build(node: ComponentNode, props: NodeProps, buildChild: BuildChild): NativeView;
}
```

A surface may draw from several catalogs at once. The same implementation can be registered in more than one of them, and a child can come from a different catalog than its parent. Two rules follow:

- Any adapter-side preparation of implementations (wrapping them in host elements, binding an injector, caching a view factory) MUST cover every catalog in `surface.availableCatalogs`, not only `surface.defaultCatalog`.
- An implementation reads its props through the schema of the entry the resolver chose (`node.impl.schema`), not through a schema captured when the implementation was authored, unless the two are the same object.

Because UI paradigms and language type systems differ significantly, this API can take several forms depending on the target language:

#### Form 1: Direct Property & Binding Access (Recommended for Dart, Swift, Go)

In statically typed languages without compile-time schema introspection, components receive the `ComponentNode` and its current props, and unpack properties with explicit casts.

_Example in Dart (Flutter against the Dart `a2ui_core`):_

```dart
typedef ChildWidgetBuilder = Widget Function(ComponentNode child);

class FlutterComponentImplementation extends ComponentApi {
  final Widget Function(
    BuildContext context,
    ComponentNode node,
    NodeProps props,
    ChildWidgetBuilder buildChild,
  ) builder;

  const FlutterComponentImplementation({
    required super.name,
    required super.schema,
    required this.builder,
  });
}

// Authoring a Button component:
final buttonImplementation = FlutterComponentImplementation(
  name: 'Button',
  schema: buttonSchema,
  builder: (context, node, props, buildChild) {
    final child = props['child'] as ComponentNode?;
    final action = props['action'] as Future<void> Function()?;

    return ElevatedButton(
      onPressed: action,
      child: child == null ? null : buildChild(child),
    );
  },
);
```

A control that holds native state, such as a text field's controller, keeps it in the widget's `State`: it creates the controller once, updates it when the binding's value differs from the field's text, writes user edits through the `WritableBinding`, and disposes the controller when the view unmounts.

#### Form 2: Generic Typed Accessor Helpers

To minimize manual map indexing and casting, the adapter can expose lightweight accessors on `NodeProps`:

```dart
extension NodePropsAccessors on NodeProps {
  String? stringValue(String key) =>
      (this[key] as ResolvedBinding<Object?>?)?.value?.toString();

  WritableBinding<Object?>? writableBinding(String key) {
    final Object? binding = this[key];
    return binding is WritableBinding ? binding : null;
  }

  Future<void> Function()? action(String key) =>
      this[key] as Future<void> Function()?;

  List<ComponentNode> childNodes(String key) =>
      (this[key] as List<Object?>?)?.cast<ComponentNode>() ?? const [];
}
```

A binding's value is not typed by the schema, so a builder converts it where it needs a typed value:

```dart
builder: (context, node, props, buildChild) {
  final checked = props.writableBinding('value');
  return Checkbox(
    value: checked?.value == true,
    onChanged: (v) => checked?.set(v ?? false),
  );
}
```

#### Form 3: Schema-Inferred Typed Props (TypeScript / Dynamic Ecosystems)

Languages with advanced generic type inference (like TypeScript with Zod) can infer the exact resolved shape from the component schema:

- Primitive paths collapse to raw types (`DynamicString` $\to$ `string`).
- Actions collapse to closures (`Action` $\to$ `() => void`).
- Child lists collapse to `ComponentNode[]`.

```typescript
// Component author receives strictly-typed `props` inferred from schema:
export const ReactButton = createComponentImplementation(
  ButtonApi,
  ({ props, buildChild }) => {
    // TypeScript knows props.label is string | undefined and props.action is (() => void) | undefined
    return <button onClick={props.action}>{props.label}</button>;
  },
);
```

#### Form 4: Stateful / Imperative Instances (Vanilla DOM, Android Views)

In frameworks where UI nodes are long-lived mutable objects rather than rebuildable virtual structures, `ComponentImplementation` provides an instantiation factory:

```typescript
interface ComponentInstance {
  mount(parent: NativeElement): void;
  update(node: ComponentNode): void;
  unmount(): void;
}

interface ComponentImplementation extends ComponentApi {
  createInstance(node: ComponentNode): ComponentInstance;
}
```

---

### 4.3 Optional Helper APIs & Ergonomic Sugar

Adapters may provide convenience helpers to eliminate boilerplate when registering catalogs or creating implementations:

1. **`createComponentImplementation(api, builder)`**: Validates and bundles API schema with builder function.
2. **`createCatalog({ id, protocolVersion, components, functions })`**: Constructs a catalog container with registered implementations. A catalog for v1.0 or later MUST declare its `protocolVersion`; Core rejects an unversioned catalog on a surface at v1.0 or later.
3. **Reactivity Wrappers / Hooks**:
   - React: `useNodeProps(node)` / `useSignalValue(node.props)` returning current resolved props.
   - Flutter: `NodePropsBuilder(node: node, builder: (context, props) => ...)` or `ValueListenable` adapter.
   - SwiftUI: `Node.binding(for: "key", default: defaultValue)` wrapping `WritableBinding` into a SwiftUI `Binding<T>`.

---

## 5. Basic Catalog Implementation

Each adapter package (or the shared web element layer, for web adapters) ships pre-built implementations for the standard Basic Catalog components:

- **Containers** (`Row`, `Column`, `Card`, `Modal`, `List`, `Tabs`): Render children in order via `buildChild`. In `List`, items are already expanded by Core per data array entry; the container maps each child node without indexing logic.
- **Display Leaves** (`Text`, `Image`, `Icon`, `Video`, `AudioPlayer`, `Divider`): Read resolved primitives from `node.props` and render native view equivalents.
- **Interactive Controls** (`Button`, `TextField`, `CheckBox`, `Slider`, `ChoicePicker`, `DateTimeInput`):
  - Handle two-way value binding via `WritableBinding.set()`.
  - Invoke `NodeAction` closures synchronously on native user gestures (§3).
  - Consume the resolved validation properties on `node.props`: disable or block the control's action while `isValid` is `false`, render `validationErrors` as blocking error messages next to the control, and SHOULD render failed `warning` and `info` entries from `validationResults` as non-blocking hints styled by severity.

### Building v1.0 and v0.9 Basic Catalogs and Sharing Component Code

The v1.0 basic catalog adds `TextField.placeholder`, `Video.posterUrl`, and `Slider.steps`, marks `openUrl` as `requiresUserActivation: true`, and defines validation functions (`required`, `regex`, `length`, `numeric`, `email`) that return `ValidationResult` objects rather than booleans. Because Core normalizes both v0.9 boolean checks and v1.0 `ValidationResult` checks into the same `isValid`, `validationErrors`, and `validationResults` props on `node.props`, a single set of component UI implementations can serve both protocol versions:

1. **Write one shared set of component UI implementations** (under `catalog/basic/` or the shared element layer) that reads the normalized check props (`isValid`, `validationErrors`, `validationResults`) and treats the v1.0-only properties (`TextField.placeholder`, `Video.posterUrl`, `Slider.steps`) as optional.
2. **Construct a separate `Catalog` entry set per protocol version**:
   - Pair each shared component implementation with that version's `ComponentApi` (component name and version-specific schema).
   - Register the Core SDK's basic catalog `FunctionImplementation`s for that protocol version alongside the components, since Core evaluates every function call in props and actions.
   - Export the v1.0 catalog from the primary catalog entrypoint (with `protocolVersion: 'v1.0'`) and the v0.9 catalog from the `./v0_9` subpath (with `protocolVersion: 'v0.9'`).

Follow the Basic Catalog Implementation Guide for each catalog version: [v1.0](../../catalogs/basic/v1/basic_catalog_implementation_guide.md) and [v0.9.1](../../specification/v0_9_1/docs/basic_catalog_implementation_guide.md).

---

## 6. Node Dispatcher Mechanics (`NodeView`)

The internal recursive renderer maps a `ComponentNode` to its native UI element.

```typescript
type BuildChild = (child: ComponentNode) => NativeView;

function NodeView(node: ComponentNode): NativeView;
```

### Execution Steps:

1. **Check `node.state`**:
   - `resolved`: Render `node.impl`, the implementation the resolver already chose.
   - `pending`: Render a non-blocking loading placeholder.
   - `unknown-type` and `cyclic`: Render a visible diagnostic. The resolver has already reported `UNKNOWN_COMPONENT_TYPE` or `CYCLIC_REFERENCE` to the surface, so the adapter does not report it again.
2. **Subscribe to `node.props`**: Rebuild the view when the node's props emit, and pass the current props to the implementation. Unsubscribe when the view unmounts.
3. **Invoke Builder**: Pass `node`, its current props and a `buildChild` callback to the implementation.
4. **Provide `buildChild`**: Construct a closure `(child: ComponentNode) => NativeView` that recursively invokes `NodeView(child)`.
5. **Preserve Identity**: Key each child's view by `node.instanceId`. An `instanceId` names a component at a data scope, so in an explicit child list the view follows its component through a reorder, and in a template it stays with an index. The node object behind an `instanceId` can change while the id stays: when a placeholder's component arrives, when the component's type changes, and when an explicit child list is reordered. A view keyed by `instanceId` therefore moves its subscriptions to the new node, and resets its view state when the type changes.

---

## 7. Lifecycle & Destruction

A framework adapter coordinates two distinct lifecycles: the **Node lifecycle** managed by Core's `NodeResolver`, and the **View lifecycle** managed by the host UI framework.

### Separation of Ownership

- **Core owns `ComponentNode`**: `NodeResolver` creates nodes when referenced, updates them as properties change, and disposes them when unreferenced or deleted. The adapter MUST NOT call `node.dispose()` or attempt to destroy nodes manually.
- **The Adapter owns Native Views**: The native framework mounts, updates, and unmounts elements. The adapter's sole responsibility is to keep view lifecycles synchronized with node state and cleanly drop listeners when views detach.

### When is a native view destroyed?

1. **Child removal from a parent**: When a parent stops referencing a child, or a dynamic array shrinks, `NodeResolver` disposes that `ComponentNode` and emits an updated children list on the parent. A deleted component that is still referenced becomes a pending placeholder at its position instead. When the parent re-renders its children (keyed by `node.instanceId`), the native framework unmounts and destroys the view for the dropped child.
2. **Placeholder replacement**: When a component definition arrives after being referenced, `NodeResolver` replaces the placeholder node in place and emits a new parent props object containing the concrete `ComponentNode`. The view keyed by the placeholder's `instanceId` switches to the new node and renders the concrete component in place of the placeholder.
3. **Surface unmount**: When the host application removes the `Surface` view/widget (e.g. user navigates away), the adapter MUST invoke `nodeResolver.dispose()`. This recursively disposes all living `ComponentNode` instances, cancels data model subscriptions, and drops internal listeners.

### View cleanup obligations

Whenever a native component unmounts (via framework hooks like React `useEffect` cleanup, Flutter `State.dispose()`, Angular `DestroyRef`, or SwiftUI teardown):

- **Unsubscribe from `node.props`**: Terminate the signal subscription or listener immediately to prevent memory leaks and ghost updates.
- **Flush or discard pending debounced writes**: If the component debounced user input (e.g., text typing), flush pending writes to `WritableBinding.set()` or cancel active timers.
- **Release native resources**: Dispose native controllers, focus nodes, gesture recognizers, or media players.
- **Dispose per-view binders**: A view that owns a binder or controller of its own (a long-lived element in Form 4) disposes it when the view disconnects, not only when the view is handed a different node. A disconnected view that keeps its binder keeps its data model subscriptions alive with it.

### Node Teardown Callbacks (`addCleanup` and `onDestroyed`)

The adapter does not need to orchestrate complex teardown pipelines. `ComponentNode` provides two built-in hooks:

1. **`node.addCleanup(fn)`**: Registers a callback that runs automatically when the node is disposed by `NodeResolver`. Use it for resources tied to the node, such as a subscription created for it. Native controllers belong to the view, which can unmount while its node lives on or outlive a node that is replaced, so they are released in the view's own unmount hook.
2. **`node.onDestroyed`**: An event that fires exactly once when the node is disposed.

In modern declarative frameworks (React, Flutter, SwiftUI), child views unmount naturally when removed from their parent's children list. Between the framework's native unmount hooks and `node.addCleanup()`, lifecycle disposal requires minimal adapter-side code.

---

## 8. Testing

### Conformance Grounding

The repository maintains language-agnostic conformance tests in [`conformance/`](../../conformance/README.md). Core SDK conformance (`conformance/core/`) must pass in the target language before an adapter can function reliably.

### Required Adapter Test Suite

| Test Area                      | Assertion                                                                                                                                                                                                                   |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tree Hierarchy**             | Loading a surface payload builds a native view tree exactly matching the `ComponentNode` graph, with children in declared order.                                                                                            |
| **Single-message surface**     | A `createSurface` at v1.0 or later carrying `components` and `dataModel` renders without a following `updateComponents`.                                                                                                    |
| **Progressive Arrival**        | When a component is referenced before its definition arrives, the adapter renders a placeholder, then upgrades to the real component in place without remounting the parent.                                                |
| **Dynamic Repeaters (`List`)** | Modifying an array in the `DataModel` (insert, delete, reorder) updates child widgets without remounting unaffected siblings. A template item that reads `@index` shows its position.                                       |
| **Two-Way Binding**            | User input on native controls calls `WritableBinding.set()`, updates the Core `DataModel`, and updates all observing components.                                                                                            |
| **Action Execution**           | Triggering native events (clicks, taps) executes the action closure. An `event` action dispatches the client event with correctly scoped context; a `functionCall` action runs the function locally and dispatches nothing. |
| **User activation**            | A `functionCall` action on an activation-gated function (`openUrl`) runs when fired from a native gesture and is refused when fired without one.                                                                            |
| **Multiple catalogs**          | A surface whose root and one descendant come from two different catalogs renders both, and each implementation receives props shaped by its own catalog's schema.                                                           |
| **Validation results**         | A check that returns `{valid: false, severity: "error", message}` disables the control and shows the message; one returning `severity: "warning"` leaves the control enabled; a boolean `false` behaves as an error.        |
| **Accessibility**              | `accessibility.label`, `description`, `live`, and `hidden` reach the platform accessibility API on the focusable element, and an explicit `label` overrides the inferred one.                                               |
| **Theme ignored**              | A `createSurface` at v1.0 or later that carries a `theme` object renders exactly as one without it.                                                                                                                         |
| **Fallback States**            | Unknown component types and cyclic references render visual diagnostics without crashing, and the adapter reports nothing itself.                                                                                           |
| **Teardown & Cleanup**         | Unmounting `Surface` or deleting components releases all property subscriptions and frees memory.                                                                                                                           |

---

## 9. Gallery App Specification

The Gallery App is a comprehensive development, demonstration, and debugging tool that serves as the reference environment for an A2UI renderer. It allows developers to visualize components, inspect the live data model, step through progressive rendering, and verify interaction logic.

### UX Architecture

The Gallery App implements a three-column layout:

1. **Left Column (Sample Navigation)**: A list of available A2UI sample scenarios, grouped by protocol version, with a version selector. Each version loads its own example set: the v0.9 examples from `specification/v0_9/catalogs/basic/examples` and the v1.0 examples from `catalogs/basic/v1/examples`.
2. **Center Column (Rendering & Messages)**:
   - **Surface Preview**: Renders the active A2UI `Surface`.
   - **JSON Message Stream**: Displays the sequence of A2UI messages.
   - **Interactive Stepper**: An "Advance" control allowing developers to process messages one by one to verify progressive rendering and placeholder upgrades.
3. **Right Column (Live Inspection)**:
   - **Data Model Pane**: A live-updating view of the full `DataModel`.
   - **Action Logs Pane**: A log of triggered actions, their resolved context scopes, and any RPC messages the processor emits.

The gallery registers one basic catalog per supported protocol version with its processor, so a sample's `version` field alone selects the catalog. At least one sample mixes a custom catalog with the basic catalog on one surface.

### Integration Testing Requirements

Every framework adapter implementation should include integration tests that utilize the Gallery App's sample scenarios to verify:

- **Static Rendering**: Basic components (e.g. "Simple Text") render correctly.
- **Layout Integrity**: Layout containers ("Row Layout", "Column Layout") arrange children properly.
- **Two-Way Binding**: Modifying an interactive field (like `TextField` or `CheckBox`) updates both the UI and the underlying `DataModel` simultaneously.
- **Reactive Logic**: Changes in one component dynamically update dependent components.
- **Action Context Scoping**: Actions emitted from nested templates (like `List`) contain correctly resolved data paths.
- **Version Coverage**: Each sample set renders under its own protocol version, including at least one v1.0 sample with inline `components` and `dataModel`.

---

## 10. Reference Implementations

Consult existing implementations for concrete language mechanics:

| Codebase                                                                       | Framework    | Architecture Highlights                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`typescript/web_core/src/universal`](../../typescript/web_core/src/universal) | Web (shared) | The shared custom element layer the three web renderers render through, including the basic catalog elements for v0.9 and v1.0. See the [universal custom elements feature blueprint](../features/universal_custom_elements.blueprint.md). |
| [`renderers/react`](../../renderers/react)                                     | React        | `NodeResolver` owned by `Surface`; every node renders as a custom element; React implementations are hosted in portal elements; schema-typed props inference.                                                                              |
| [`renderers/angular`](../../renderers/angular)                                 | Angular      | Angular Signals, dependency-injected catalog resolution, dual-mode native/universal rendering.                                                                                                                                             |
| [`renderers/lit`](../../renderers/lit)                                         | Lit          | Thin package over the shared web custom element layer.                                                                                                                                                                                     |
| [`dart/a2ui_flutter`](../../dart/a2ui_flutter)                                 | Flutter      | Flutter widget adapter over the Dart `a2ui_core` Node API.                                                                                                                                                                                 |
| [`swift/swiftui`](../../swift/swiftui)                                         | SwiftUI      | SwiftUI `View` integration, `@Environment` propagation, `Binding<T>` bridging.                                                                                                                                                             |
