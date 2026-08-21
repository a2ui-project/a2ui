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
 * Experimental surface renderer driven by the node layer.
 *
 * Where `A2uiSurface` walks component ids and lets each component's wrapper
 * run its own `GenericBinder`, this surface constructs one `NodeResolver` and
 * renders the resolved `ComponentNode` tree it maintains. Each implementation
 * carries a generated `view` (see `adapter.tsx`) that subscribes to its own
 * node's props and converts them back to the shapes existing views expect, so
 * a data change re-renders exactly the affected component. This surface only
 * dispatches: it hands each `view` its node and a `buildChild` that renders
 * resolved child nodes, falling back to `DeferredChild` recursion over the
 * raw definitions for ids the node layer could not classify, so catalogs can
 * migrate incrementally.
 */

import React, {memo, useCallback, useMemo, useSyncExternalStore} from 'react';
import {
  ComponentContext,
  type ComponentNode,
  isComponentNode,
  NodeResolver,
  effect,
  getValue,
  peekValue,
  type SurfaceModel,
} from '@a2ui/web_core/v0_9';
import type {ReactComponentImplementation} from './adapter';
import {NodeSurfaceContext, type NodeBuildChild} from './node-view';
import {DeferredChild} from './A2uiSurface';

/** Renders an implementation that has no `view`: its wrapper binds itself. */
const RenderFallback: React.FC<{
  surface: SurfaceModel<ReactComponentImplementation>;
  node: ComponentNode<ReactComponentImplementation>;
  impl: ReactComponentImplementation;
  buildChild: (id: string, basePath?: string) => React.ReactNode;
}> = ({surface, node, impl, buildChild}) => {
  const context = useMemo(
    () => new ComponentContext(surface, node.componentId, node.dataPath),
    [surface, node],
  );
  const Render = impl.render;
  return <Render context={context} buildChild={buildChild} />;
};

const NodeView = memo(
  ({
    surface,
    node,
  }: {
    surface: SurfaceModel<ReactComponentImplementation>;
    node: ComponentNode<ReactComponentImplementation>;
  }) => {
    const buildChild = useCallback<NodeBuildChild>(
      (child, basePath) => {
        if (isComponentNode(child)) {
          return <NodeView key={child.instanceId} surface={surface} node={child} />;
        }
        // Not resolved by the node layer; recurse over the raw definitions.
        return (
          <DeferredChild
            key={`${child}-${basePath ?? node.dataPath}`}
            surface={surface}
            id={child}
            basePath={basePath ?? node.dataPath}
          />
        );
      },
      [surface, node],
    );

    if (node.state === 'unknown-type') {
      return <div style={{color: 'red'}}>Unknown component type: {node.componentId}</div>;
    }
    if (node.isPlaceholder) {
      return <div style={{color: 'gray', padding: '4px'}}>[Loading {node.componentId}...]</div>;
    }
    const impl = node.impl;
    if (!impl) {
      // A resolved node always carries its impl; this narrows the type.
      return null;
    }
    const View = impl.view;
    if (!View) {
      return <RenderFallback surface={surface} node={node} impl={impl} buildChild={buildChild} />;
    }
    return <View node={node} buildChild={buildChild} />;
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
  // disposed by its own unsubscribe. StrictMode's double mount creates and
  // disposes two in turn.
  const box = useMemo(
    () => ({resolver: undefined as NodeResolver<ReactComponentImplementation> | undefined}),
    [surface],
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      const resolver = new NodeResolver(surface, surface.catalog);
      box.resolver = resolver;
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
  return (
    <NodeSurfaceContext.Provider value={surface}>
      <NodeView surface={surface} node={root} />
    </NodeSurfaceContext.Provider>
  );
};
