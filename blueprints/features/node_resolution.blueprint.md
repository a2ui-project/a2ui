---
feature_name: node_resolution
module_blueprints:
  - a2ui_core
  - a2ui_framework_adapter
dependencies: []
date_added: 2026-09-18
---

# **Node Resolution Feature Blueprint**

This document specifies the node resolution layer of the core SDK: the part of `a2ui.core.resolution` that turns a surface's flat component map and data model into a live tree of resolved component instances, so that renderers and headless consumers read ready-to-use values.

The layers have separate responsibilities:

- `SurfaceModel` holds the component definitions and data model.
- `NodeResolver` maintains live, framework-independent `ComponentNode` instances, resolving their child references, values and actions.
- The framework adapter subscribes to those instances and renders native views rather than resolving the definitions itself.

---

## **Requirements**

### **1. Resolver**

- A host opts in by constructing a `NodeResolver` for one `SurfaceModel`. The resolver exposes the resolved root as an observable that tracks the surface's root component; the tree is what is reachable from it.
- The resolver creates, updates and disposes nodes as the surface's components and data change. Disposing the resolver disposes every node.

### **2. Nodes**

- A `ComponentNode` is one resolved component instance at one position in the tree. One node exists per referencing position: two parents that reference the same component id hold two distinct nodes.
- `instanceId` names a component at a data scope and MUST be distinct among siblings. In an explicit child list it follows the component when the list is reordered; a template item's data scope is its index in the array, not a key in the item's data.
- The node object behind an `instanceId` can be replaced while the id stays: when the component definition changes type, when a placeholder's component arrives, and when an explicit child list is reordered. A node whose position is gone is disposed, and disposing a node disposes its subtree.
- `props` is a reactive map keyed by the component's schema property names. It holds a `ResolvedBinding` for each dynamic property, a `NodeAction` for each action, child nodes for each child reference the resolver mounts, and the literal value otherwise. It reflects the current component definition.
- `dataPath` is the data scope the node resolves relative paths against.

### **3. Bindings**

- Every dynamic property (a property whose schema is one of the `Dynamic*` common types) resolves to one `ResolvedBinding`: the current value plus, if and only if the payload bound a data path, a write capability.
- A write lands at the bound path, resolved against the node's data scope.
- A binding is a snapshot: a changed value arrives as a new binding through the node's `props`.

### **4. Children**

- A property whose schema references the shared `ComponentId` definition (single child) or `ChildList` definition (explicit id list or data-driven template) is a child reference.
- The resolver mounts single references, explicit id lists and templates in top-level properties, and single references in objects within top-level arrays.
- A single reference resolves to one child node; an explicit list and a template alike resolve to one list of child nodes.
- A template resolves its path against the parent's scope and spawns one node per array item, at the data scope `<template path>/<index>`.

### **5. Actions**

- An action property resolves to a `NodeAction`. Invoking it MUST resolve the action payload at that moment, not at bind, in the node's data scope.
- For an `event` payload the surface emits one client action carrying the resolved context and the source component id. For a `functionCall` payload the catalog function executes and the surface MUST emit no action event.

### **6. Notification**

- A node's `props` emits when its own resolved properties change, and only then. A child's change emits on the child; replacing a child emits on the parent.
- An update that changes several properties MUST emit once, with the complete new state.

### **7. Placeholders**

- A partly streamed surface still resolves to a tree: a reference to a component the surface does not currently hold resolves to a placeholder node with state `pending`. When the component arrives, a resolved node replaces the placeholder at the same position.
- A component whose type has no catalog entry resolves to a placeholder node with state `unknown-type`, and a reference that repeats an ancestor's component id at the same data scope resolves to one with state `cyclic`. The resolver dispatches `UNKNOWN_COMPONENT_TYPE` and `CYCLIC_REFERENCE` to the surface.

---

## **Detailed Description of Changes**

### **Example: a template with two items**

A surface contains these two component definitions:

```json
[
  {
    "id": "root",
    "component": "Column",
    "children": {"componentId": "nameField", "path": "/people"}
  },
  {
    "id": "nameField",
    "component": "TextField",
    "label": "Name",
    "value": {"path": "name"}
  }
]
```

With data `{"people": [{"name": "Ada"}, {"name": "Lin"}]}`, the root's `children` property resolves to two distinct nodes:

| `componentId` | `dataPath`  | `value` binding's current value |
| ------------- | ----------- | ------------------------------- |
| `nameField`   | `/people/0` | `"Ada"`                         |
| `nameField`   | `/people/1` | `"Lin"`                         |

Both nodes refer to the same component definition but have distinct `instanceId`s. The relative path `name` resolves within each node's data scope.

Calling `set("Grace")` on the first node's `value` binding updates `/people/0/name`. That node emits new `props` containing a binding whose value is `"Grace"`. The second node and the root do not emit: their resolved properties have not changed.

### **Interfaces**

The blocks below use the core blueprint's notation. Names are normative; parameter spelling follows each language.

```typescript
/** Whether a node is resolved or stands in for a component the surface cannot resolve at that position. */
type NodeState = 'resolved' | 'pending' | 'unknown-type' | 'cyclic';

/** Resolved node properties, keyed by the component's schema property names. */
type NodeProps = Record<string, unknown>;

/** A resolved action property. Invoking it dispatches the action in the node's data scope. It may return a future that completes when the dispatch does. */
type NodeAction = () => void | Promise<void>;

interface ComponentNode<C extends ComponentApi> {
  /** Names the component at this node's data scope; distinct among siblings. */
  readonly instanceId: string;
  /** Unique across the document for this node object; a replaced node gets a new one. */
  readonly id: string;
  /** The component id from the payload. */
  readonly componentId: string;
  /** The declared component type; `'Placeholder'` for a pending or cyclic node. */
  readonly type: string;
  /** The data scope this node resolves relative paths against, e.g. '/items/0'. */
  readonly dataPath: string;
  readonly state: NodeState;
  /** True for every state other than `resolved`. */
  readonly isPlaceholder: boolean;
  /** True once the resolver has disposed this node. */
  readonly disposed: boolean;
  /** The resolved catalog entry; absent while the node is a placeholder. */
  readonly impl?: C;
  /** The binding context the resolver bound this node with; absent while the node is a placeholder. */
  readonly context?: ComponentContext;
  /** Resolved, reactive properties. */
  readonly props: Signal<NodeProps>;
  /** Fires once, when this node is disposed. */
  readonly onDestroyed: EventSource<void>;
  /** Registers work to run when this node is disposed. */
  addCleanup(cleanup: () => void): void;
}

/** One dynamic property's current value. */
interface ResolvedBinding<T> {
  readonly value: T;
}

/** A binding whose payload bound a data path. */
interface WritableBinding<T> extends ResolvedBinding<T> {
  /** Writes to the bound path, resolved against the node's data scope. */
  set(value: T): void;
}

class NodeResolver<C extends ComponentApi> {
  /** Builds and maintains the tree for one surface. An implementation may also take the surface's default catalog. */
  constructor(surface: SurfaceModel<C>);
  /** The resolved root; absent until the surface has a root component. */
  readonly rootNode: Signal<ComponentNode<C> | undefined>;
  /** Tears down the tree and stops tracking the surface. */
  dispose(): void;
}
```

`Signal<T>` is an observable value, readable synchronously and notifying subscribers on change (the core blueprint's stateful stream); `EventSource<T>` is the state layer's event notifier.

### **Changes to existing core contracts**

1. **Dynamic properties become bindings.** Node props hold a `ResolvedBinding` per dynamic property in place of a value plus a setter.
2. **Action dispatch.** `SurfaceModel.dispatchAction` emits `event` payloads only. A node's `NodeAction` executes a `functionCall` payload itself, in its data scope, and emits no action event.

### **Changes to the framework adapter contract**

The [framework adapter blueprint](../modules/a2ui_framework_adapter.blueprint.md) describes how an adapter renders the node tree: one resolver per surface, a view per node that subscribes to the node's `props`, a view for every node that is not resolved, and bindings unwrapped at the control boundary.

---

## **Links**

- Design thread: [Issue #1282](https://github.com/a2ui-project/a2ui/issues/1282)
- Core blueprint, resolution layer: [`a2ui_core.blueprint.md`](../modules/a2ui_core.blueprint.md#f-resolution-layer-a2uicoreresolution)
- Framework adapter blueprint: [`a2ui_framework_adapter.blueprint.md`](../modules/a2ui_framework_adapter.blueprint.md)

---

## **Test Cases & Conformance**

The shared cases for this feature belong in `conformance/core/node_resolution.yaml`. An implementation MUST pass every case below.

- **Resolver**
  - Root creation and removal are tracked on `rootNode`.
  - Disposing the resolver disposes every node and fires each node's `onDestroyed` once.
- **Nodes**
  - Two parents referencing one component hold two nodes; dropping one parent disposes its node and keeps the other's child alive.
  - Sibling instance ids stay distinct after an insertion and through a placeholder replacement.
- **Bindings**
  - Dynamic values arrive as bindings, writable if and only if path-bound; a write through a template item's binding lands at the item's scope.
  - A data change at a bound path emits on the node with a new binding holding the new value.
- **Children**
  - A single reference, an explicit list and a template each mount their children.
  - A template spawns one node per item at the item's scope and grows and shrinks with the array.
- **Actions**
  - Action context resolves at dispatch, not at bind.
  - A `functionCall` action executes when fired and emits no action event.
- **Notification**
  - A child property change does not emit on the parent.
  - A placeholder replacement emits on the parent.
  - A multi-property update emits once, with the complete new state.
- **Placeholders**
  - A reference to a component that has not arrived resolves to a node with state `pending`; when the component arrives, a resolved node replaces it at the same position.

---

## **Implementation Steps**

1. **Bindings.** Introduce `ResolvedBinding` and its writable variant, and publish one per dynamic property.
2. **Node and resolver.** Implement `ComponentNode` and `NodeResolver` over `SurfaceModel`: root tracking, schema-derived classification of child references, per-position identity, template expansion, placeholder replacement, per-node `props` emission and subtree disposal.
3. **Actions.** Resolve action payloads at dispatch in the node's data scope, execute function calls there, and restrict the surface's action stream to events.
4. **Adapter.** Render the node tree as the framework adapter blueprint describes.
5. **Conformance.** Cover the cases above, list the file in `conformance/README.md`, and record the feature in the codebase blueprint's `implemented_features`.
