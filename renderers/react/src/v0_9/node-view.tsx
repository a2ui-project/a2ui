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

import type React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from 'react';
import {
  ComponentContext,
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
import type {ReactComponentImplementation} from './adapter';

/** Renders a resolved child node, or falls back for an unresolved id. */
export type NodeBuildChild = (
  child: ComponentNode<ReactComponentImplementation> | string,
  basePath?: string,
) => React.ReactNode;

/** What a component implementation's `view` receives from the node surface. */
export type NodeViewProps = {
  node: ComponentNode<ReactComponentImplementation>;
  buildChild: NodeBuildChild;
};

/** The surface a node view renders under, provided by `A2uiSurface`. */
export const NodeSurfaceContext = createContext<SurfaceModel<ReactComponentImplementation> | null>(
  null,
);

/** Stands in for a component that has not arrived, or has just been removed. */
export const LoadingPlaceholder: React.FC<{componentId: string}> = ({componentId}) => (
  <div style={{color: 'gray', padding: '4px'}}>[Loading {componentId}...]</div>
);

/** Unresolved-reference reports already dispatched, per surface. */
const reportedUnresolved = new WeakMap<SurfaceModel<ReactComponentImplementation>, Set<string>>();

/**
 * The in-tree notice for a child reference the resolver built no node for.
 * Also reports it through the surface's error channel once per (id, path)
 * so agents see it too, matching how the resolver reports unknown types and
 * cycles. The report runs in an effect: dispatching during render would
 * invoke onError subscribers while React is rendering, and a subscriber
 * that sets state would then warn.
 */
export const UnresolvedChildReference: React.FC<{
  surface: SurfaceModel<ReactComponentImplementation> | null;
  id: string;
  requestedPath: string;
  detail: string;
}> = ({surface, id, requestedPath, detail}) => {
  const message = `Unresolved child reference '${id}' at '${requestedPath}': ${detail}`;
  useEffect(() => {
    if (!surface) {
      return;
    }
    let seen = reportedUnresolved.get(surface);
    if (!seen) {
      seen = new Set();
      reportedUnresolved.set(surface, seen);
    }
    const key = `${id}@${requestedPath}`;
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

/** Child nodes of one view, keyed by the id a view passes back to `buildChild`, plus the child's data path. */
type ChildIndex = Map<string, ComponentNode<ReactComponentImplementation>>;

/**
 * Registers a child and returns the token views should hand back to
 * `buildChild`: the component id, or the node's `instanceId` (distinct per
 * position) when the same component is referenced twice at one scope.
 */
function registerChild(
  index: ChildIndex,
  child: ComponentNode<ReactComponentImplementation>,
): string {
  const token = index.has(`${child.componentId}@${child.dataPath}`)
    ? child.instanceId
    : child.componentId;
  index.set(`${token}@${child.dataPath}`, child);
  return token;
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
    // catalog carries ReactComponentImplementation entries.
    const token = registerChild(index, value as ComponentNode<ReactComponentImplementation>);
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
  context: ComponentContext | undefined;
  viewBuildChild: (id: string, basePath?: string) => React.ReactNode;
} {
  const surface = useContext(NodeSurfaceContext);
  const resolved = useSignalValue(node.props);

  const {viewProps, childIndex} = useMemo(() => {
    const index: ChildIndex = new Map();
    return {viewProps: toViewProps(node, resolved, index) as NodeProps, childIndex: index};
  }, [node, resolved]);

  // The component can be removed between the resolver's update and this
  // render committing; ComponentContext's constructor throws on a missing
  // model, so treat that window as not-ready rather than crashing. Callers
  // render a LoadingPlaceholder for it.
  const context = useMemo(
    () =>
      surface && surface.componentsModel.get(node.componentId)
        ? new ComponentContext(surface, node.componentId, node.dataPath)
        : undefined,
    [surface, node],
  );

  const viewBuildChild = useCallback(
    (id: string, basePath?: string): React.ReactNode => {
      const requested = basePath ?? node.dataPath;
      const childNode = childIndex.get(`${id}@${requested}`);
      if (childNode) {
        return buildChild(childNode, basePath);
      }
      // An instance at another data path means the reference itself is fine
      // and the requested path is not one the payload created.
      const elsewhere: string[] = [];
      for (const key of childIndex.keys()) {
        if (key.startsWith(`${id}@`)) {
          elsewhere.push(key.slice(id.length + 1));
        }
      }
      if (elsewhere.length > 0) {
        return (
          <UnresolvedChildReference
            key={`${id}-${requested}`}
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
    [childIndex, buildChild, node, surface],
  );

  if (!surface) {
    throw new Error('A2UI component views render only inside A2uiSurface.');
  }
  return {viewProps, context, viewBuildChild};
}
