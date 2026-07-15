/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Experimental surface renderer driven by the node layer.
 *
 * Where `A2uiSurface` walks component ids and lets each component's wrapper
 * run its own `GenericBinder`, this surface constructs one `NodeResolver` and
 * renders the resolved `ComponentNode` tree it maintains. Each node's view
 * subscribes to that node's props signal only, so a data change re-renders
 * exactly the affected component.
 *
 * Views are reused unchanged: node props are converted back to the shapes the
 * existing view contract expects (child ids as strings, template children as
 * `{id, basePath}` pairs) and `buildChild` maps those refs back to their live
 * nodes. A ref the node layer did not resolve (a single-child id whose schema
 * is not declared with `componentReference()`) falls back to `DeferredChild`
 * recursion over the raw definitions, so catalogs can migrate incrementally.
 */

import React, {memo, useCallback, useMemo, useSyncExternalStore} from 'react';
import {
  ComponentContext,
  ComponentNode,
  NodeResolver,
  effect,
  getValue,
  peekValue,
  type NodeProps,
  type Signal,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import type {ReactComponentImplementation} from './adapter';
import {DeferredChild} from './A2uiSurface';

function useSignalValue<T>(signal: Signal<T>): T {
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

/** Child nodes of one view, keyed by componentId and by componentId@dataPath. */
type ChildIndex = Map<string, ComponentNode>;

function registerChild(index: ChildIndex, child: ComponentNode): void {
  index.set(`${child.componentId}@${child.dataPath}`, child);
  if (!index.has(child.componentId)) {
    index.set(child.componentId, child);
  }
}

/**
 * Converts node-resolved props to the shapes existing views were written
 * against: a child node becomes its componentId string when it shares the
 * parent's data scope, and an `{id, basePath}` pair when it was spawned at a
 * scoped path (a template item). The nodes themselves are collected into
 * `index` for `buildChild` to find again.
 */
function toViewValue(parent: ComponentNode, value: unknown, index: ChildIndex): unknown {
  if (value instanceof ComponentNode) {
    registerChild(index, value);
    if (value.dataPath !== parent.dataPath) {
      return {id: value.componentId, basePath: value.dataPath};
    }
    return value.componentId;
  }
  if (Array.isArray(value)) {
    return value.map(item => toViewValue(parent, item, index));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      result[key] = toViewValue(parent, inner, index);
    }
    return result;
  }
  return value;
}

const NodeView = memo(
  ({surface, node}: {surface: SurfaceModel<ReactComponentImplementation>; node: ComponentNode}) => {
    const resolved = useSignalValue(node.props);

    const {viewProps, childIndex} = useMemo(() => {
      const index: ChildIndex = new Map();
      const converted: NodeProps = {};
      for (const [key, value] of Object.entries(resolved)) {
        converted[key] = toViewValue(node, value, index);
      }
      return {viewProps: converted, childIndex: index};
    }, [node, resolved]);

    const context = useMemo(
      () =>
        node.isPlaceholder
          ? undefined
          : new ComponentContext(surface, node.componentId, node.dataPath),
      [surface, node],
    );

    const buildChild = useCallback(
      (child: string | ComponentNode, basePath?: string): React.ReactNode => {
        const childNode =
          child instanceof ComponentNode
            ? child
            : (childIndex.get(basePath ? `${child}@${basePath}` : child) ??
              childIndex.get(`${child}@${node.dataPath}`));
        if (childNode) {
          return <NodeView key={childNode.instanceId} surface={surface} node={childNode} />;
        }
        if (typeof child === 'string') {
          // Not resolved by the node layer; recurse over the raw definitions.
          return (
            <DeferredChild
              key={`${child}-${basePath ?? node.dataPath}`}
              surface={surface}
              id={child}
              basePath={basePath ?? node.dataPath}
            />
          );
        }
        return null;
      },
      [surface, childIndex, node],
    );

    if (node.isPlaceholder) {
      return <div style={{color: 'gray', padding: '4px'}}>[Loading {node.componentId}...]</div>;
    }
    const impl = surface.catalog.components.get(node.type);
    if (!impl) {
      return <div style={{color: 'red'}}>Unknown component: {node.type}</div>;
    }
    const View = impl.view;
    if (!View) {
      // Binderless implementation: no unwrapped view exists, so render the
      // wrapper, which binds from the context itself.
      const Render = impl.render;
      return <Render context={context!} buildChild={buildChild} />;
    }
    return <View props={viewProps} buildChild={buildChild} context={context!} />;
  },
);
NodeView.displayName = 'NodeView';

/**
 * Drop-in alternative to `A2uiSurface` rendering from a `NodeResolver`.
 */
export const A2uiNodeSurface: React.FC<{
  surface: SurfaceModel<ReactComponentImplementation>;
}> = ({surface}) => {
  // The resolver is created inside subscribe, which React calls only for
  // committed renders: a render that is discarded (concurrent mode,
  // Suspense) never constructs one, and every constructed resolver is
  // disposed by its own unsubscribe. StrictMode's double mount simply
  // creates and disposes two in turn.
  const box = useMemo(
    () => ({resolver: undefined as NodeResolver<ReactComponentImplementation> | undefined}),
    [surface],
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      const resolver = new NodeResolver(surface, surface.catalog);
      box.resolver = resolver;
      onChange();
      const stopEffect = effect(() => {
        getValue(resolver.rootNode);
        onChange();
      });
      return () => {
        stopEffect();
        resolver.dispose();
        if (box.resolver === resolver) {
          box.resolver = undefined;
        }
      };
    },
    [surface, box],
  );
  const getSnapshot = useCallback(
    () => (box.resolver ? peekValue(box.resolver.rootNode) : undefined),
    [box],
  );
  const root = useSyncExternalStore(subscribe, getSnapshot);

  if (!root) {
    return <div style={{color: 'gray', padding: '4px'}}>[Loading root...]</div>;
  }
  return <NodeView surface={surface} node={root} />;
};
