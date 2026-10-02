/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * The node rendering layer: everything that turns a resolved `ComponentNode`
 * into React output.
 *
 * A node renders as its implementation's custom element (`ChildElement`). For
 * a React implementation that element is a host (`catalog/react_host_element.ts`)
 * and React renders `NodeContent` inside it: the implementation's `view` with
 * the host's node and a `buildChild` that renders child nodes as their own
 * elements. A Web Component renders its own children; the React hosts it
 * creates register with the surface under the nearest React-rendered element
 * above them, and `HostedChildren` beside that element portals `NodeContent`
 * into each. The React tree therefore nests like the DOM, so context, error
 * boundaries and events pass from a component to the components it renders,
 * whether or not a Web Component sits in between. Each factory-made
 * implementation carries a generated `view` (see `adapter.tsx`) that subscribes
 * to its node's props through `useNodeView`, so a data change re-renders
 * exactly the affected component.
 *
 * Every node that reaches a host is resolved: `A2uiSurface` prepares the
 * catalogs, so `impl` is a web component, and the parent only renders nodes
 * that have a `context`.
 */

import type React from 'react';
import {memo, useCallback, useEffect, useMemo, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {
  type ComponentContext,
  type ComponentNode,
  isComponentNode,
  ResolvedBinding,
  isWritable,
  effect,
  getValue,
  peekValue,
  type NodeProps,
  type Signal,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import type {
  NodeBuildChild,
  ReactCatalogComponent,
  ReactComponentImplementation,
} from './react_component_implementation';
import {WebComponentNode} from './web_component_node';
import {HostOwner, HostRegistry} from './host_registry';

/** The context of a node a host renders. */
function contextOf(node: ComponentNode): ComponentContext {
  if (!node.context) {
    throw new Error(`A2UI views render only resolved nodes; '${node.componentId}' has no context.`);
  }
  return node.context;
}

/** Stands in for a component that has not arrived, or has just been removed. */
export const LoadingPlaceholder: React.FC<{componentId: string}> = ({componentId}) => (
  <div style={{color: 'gray', padding: '4px'}}>[Loading {componentId}...]</div>
);

/** Unresolved-reference reports already dispatched, per surface. */
const reportedUnresolved = new WeakMap<SurfaceModel<ReactCatalogComponent>, Set<string>>();

/**
 * The in-tree notice for a child reference the resolver built no node for.
 * Also reports it through the surface's error channel once per (id, path)
 * so agents see it too, matching how the resolver reports unknown types and
 * cycles. The report runs in an effect: dispatching during render would
 * invoke onError subscribers while React is rendering, and a subscriber
 * that sets state would then warn.
 */
export const UnresolvedChildReference: React.FC<{
  surface: SurfaceModel<ReactCatalogComponent>;
  id: string;
  requestedPath: string;
  detail: string;
}> = ({surface, id, requestedPath, detail}) => {
  const message = `Unresolved child reference '${id}' at '${requestedPath}': ${detail}`;
  useEffect(() => {
    let seen = reportedUnresolved.get(surface);
    if (!seen) {
      seen = new Set();
      reportedUnresolved.set(surface, seen);
    }
    const key = JSON.stringify([id, requestedPath]);
    if (!seen.has(key)) {
      seen.add(key);
      void surface.dispatchError({code: 'UNRESOLVED_CHILD_REFERENCE', message});
    }
  }, [surface, id, requestedPath, message]);
  return <div style={{color: 'red'}}>{message}</div>;
};

export function useSignalValue<T>(signal: Signal<T>): T {
  const subscribe = useCallback(
    (onChange: () => void) =>
      effect(() => {
        getValue(signal);
        onChange();
      }),
    [signal],
  );
  const getSnapshot = useCallback(() => peekValue(signal), [signal]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Child nodes of one view by `node.id`, the token the conversion puts in view
 * props, in prop order. `render`-only implementations pass raw component ids
 * instead; those resolve by scanning for `(componentId, dataPath)`.
 */
type ChildIndex = Map<string, ComponentNode<ReactCatalogComponent>>;

/** Registers a child and returns the token views hand back to `buildChild`. */
function registerChild(index: ChildIndex, child: ComponentNode<ReactCatalogComponent>): string {
  index.set(child.id, child);
  return child.id;
}

/**
 * Converts node-resolved props to the shapes existing views were written
 * against: a child node becomes its componentId string when it shares the
 * parent's data scope, and an `{id, basePath}` pair when it was spawned at a
 * scoped path (a template item). The nodes themselves are collected into
 * `index` for `buildChild` to find again.
 */
function toViewValue(parent: ComponentNode, value: unknown, index: ChildIndex): unknown {
  if (isComponentNode(value)) {
    // Every node in this surface's props came from its own resolver, whose
    // catalog carries ReactCatalogComponent entries.
    const token = registerChild(index, value as ComponentNode<ReactCatalogComponent>);
    if (value.dataPath !== parent.dataPath) {
      return {id: token, basePath: value.dataPath};
    }
    return token;
  }
  if (value instanceof ResolvedBinding) {
    return toViewValue(parent, value.value, index);
  }
  if (Array.isArray(value)) {
    return value.map(item => toViewValue(parent, item, index));
  }
  if (isPlainObject(value)) {
    return toViewProps(parent, value, index);
  }
  // Rebuilding non-plain values (Map, Date, class instances) key-wise would
  // strip their prototype.
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Converts one object level of node props, unwrapping each `ResolvedBinding`
 * into the value + `set<Prop>` pair the views were written against. A
 * read-only binding gets a no-op setter, matching what `GenericBinder`
 * synthesizes for literal-valued properties.
 */
function toViewProps(
  parent: ComponentNode,
  props: Record<string, unknown>,
  index: ChildIndex,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(props)) {
    if (inner instanceof ResolvedBinding) {
      result[key] = toViewValue(parent, inner.value, index);
      result[`set${key.charAt(0).toUpperCase()}${key.slice(1)}`] = isWritable(inner)
        ? inner.set
        : () => {};
    } else {
      result[key] = toViewValue(parent, inner, index);
    }
  }
  return result;
}

/**
 * Subscribes to a node's props and adapts them to the `ReactA2uiComponentProps`
 * shape existing views implement:
 * converted props, a `ComponentContext`, and a string-id `buildChild` that
 * resolves through the conversion's child index before falling back to the
 * surface-provided `buildChild`.
 */
export function useNodeView(
  node: ComponentNode,
  buildChild: NodeBuildChild,
): {
  viewProps: NodeProps;
  context: ComponentContext;
  viewBuildChild: (id: string, basePath?: string) => React.ReactNode;
  rawBuildChild: (id: string, basePath?: string) => React.ReactNode;
} {
  const context = contextOf(node);
  const surface = context.dataContext.surface as SurfaceModel<ReactCatalogComponent>;
  const resolved = useSignalValue(node.props);

  const {viewProps, childIndex} = useMemo(() => {
    const index: ChildIndex = new Map();
    return {viewProps: toViewProps(node, resolved, index) as NodeProps, childIndex: index};
  }, [node, resolved]);

  const rawBuildChild = useCallback(
    (id: string, basePath?: string): React.ReactNode => {
      const requested = basePath ?? node.dataPath;
      const instances = [...childIndex.values()].filter(child => child.componentId === id);
      const childNode = instances.find(child => child.dataPath === requested);
      if (childNode) {
        return buildChild(childNode, basePath);
      }
      // An instance at another data path means the reference itself is fine
      // and the requested path is not one the payload created.
      const elsewhere = [...new Set(instances.map(child => child.dataPath))];
      if (elsewhere.length > 0) {
        return (
          <UnresolvedChildReference
            key={JSON.stringify([id, requested])}
            surface={surface}
            id={id}
            requestedPath={requested}
            detail={
              `instances exist at ${elsewhere.join(', ')}. Instances are created only at ` +
              `the data paths the payload implies; buildChild selects among them.`
            }
          />
        );
      }
      return buildChild(id, basePath);
    },
    [buildChild, node, surface, childIndex],
  );

  // A view that hands back a raw component id instead of a token resolves
  // like a `render` caller.
  const viewBuildChild = useCallback(
    (id: string, basePath?: string): React.ReactNode => {
      const childNode = childIndex.get(id);
      return childNode ? buildChild(childNode, basePath) : rawBuildChild(id, basePath);
    },
    [buildChild, rawBuildChild, childIndex],
  );

  return {viewProps, context, viewBuildChild, rawBuildChild};
}

/** Renders an implementation that has no `view`: its wrapper binds itself. */
const RenderFallback: React.FC<{
  node: ComponentNode<ReactCatalogComponent>;
  impl: ReactComponentImplementation;
  buildChild: NodeBuildChild;
}> = ({node, impl, buildChild}) => {
  // `render` reads raw component ids from the model, not the tokens the
  // conversion puts in view props, so it resolves through the raw-id map.
  const {context, rawBuildChild} = useNodeView(node, buildChild);
  const Render = impl.render;
  return <Render context={context} buildChild={rawBuildChild} />;
};

/**
 * Renders a node as its implementation's custom element. A node that has not
 * arrived renders a `LoadingPlaceholder`; one of an unknown type renders an
 * inline error.
 */
export const ChildElement = memo(({node}: {node: ComponentNode<ReactCatalogComponent>}) => {
  const owner = useMemo(() => new HostOwner(), []);
  if (node.state === 'unknown-type') {
    return <div style={{color: 'red'}}>Unknown component type: {node.type}</div>;
  }
  if (node.isPlaceholder || !node.impl || !node.context) {
    return <LoadingPlaceholder componentId={node.componentId} />;
  }
  if ('render' in node.impl) {
    // A React implementation: its host is React's own element, so its content
    // is simply the element's children.
    return (
      <WebComponentNode node={node} owner={owner}>
        <NodeContent node={node} />
      </WebComponentNode>
    );
  }
  // A Web Component renders its own children, among them React hosts that
  // React did not create. They register under this element, and their
  // content is portaled from here, inside whatever the parent view wraps
  // this element in.
  const surface = node.context.dataContext.surface as SurfaceModel<ReactCatalogComponent>;
  return (
    <>
      <WebComponentNode node={node} owner={owner} />
      <HostedChildren surface={surface} owner={owner} />
    </>
  );
});
ChildElement.displayName = 'ChildElement';

/**
 * One portal per React host owned by `owner`: a host registered for `surface`
 * whose nearest React-rendered element above it in the DOM is the one `owner`
 * identifies (`null`: there is none). Separate from the owner's view so that
 * a host connecting or disconnecting below it re-renders only this list.
 */
export const HostedChildren: React.FC<{
  surface: SurfaceModel<ReactCatalogComponent>;
  owner: HostOwner | null;
}> = ({surface, owner}) => {
  const registry = HostRegistry.forSurface(surface);
  const subscribe = useCallback(
    (listener: () => void) => registry.subscribe(owner, listener),
    [registry, owner],
  );
  const getSnapshot = useCallback(() => registry.getSnapshot(owner), [registry, owner]);
  const hosts = useSyncExternalStore(subscribe, getSnapshot);
  return (
    <>{hosts.map(({host, node}) => createPortal(<NodeContent node={node} />, host, node.id))}</>
  );
};

/**
 * The content of one host: the node's implementation, with children as their
 * elements. Memoized so a registry update, which re-renders `HostedChildren`,
 * leaves existing portals alone.
 */
export const NodeContent = memo(({node}: {node: ComponentNode<ReactCatalogComponent>}) => {
  const surface = contextOf(node).dataContext.surface as SurfaceModel<ReactCatalogComponent>;

  const buildChild = useCallback<NodeBuildChild>(
    (child, basePath) => {
      if (isComponentNode(child)) {
        return <ChildElement key={child.id} node={child} />;
      }

      // The resolver turns every child reference it can identify into a
      // node, so a leftover id was never classified. Distinguish the two
      // causes a catalog author can actually have.
      const requested = basePath ?? node.dataPath;
      const detail = surface.componentsModel.get(child)
        ? 'the component exists, but the catalog schema does not mark the referencing ' +
          'property as a component id. Use componentId() or childList() from ' +
          '@a2ui/web_core.'
        : 'no component with this id exists on the surface.';
      return (
        <UnresolvedChildReference
          key={JSON.stringify([child, requested])}
          surface={surface}
          id={child}
          requestedPath={requested}
          detail={detail}
        />
      );
    },
    [surface, node],
  );

  // Only React implementations have hosts; a universal Web Component renders
  // itself.
  const impl = node.impl;
  if (node.disposed || !impl || !('render' in impl)) {
    return null;
  }
  const View = impl.view;

  if (!View) {
    return <RenderFallback node={node} impl={impl} buildChild={buildChild} />;
  }
  return <View node={node} buildChild={buildChild} />;
});
NodeContent.displayName = 'NodeContent';
