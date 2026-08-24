/*
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Surface renderer driven by the node layer.
 *
 * `A2uiSurface` constructs one `NodeResolver` and renders the resolved
 * `ComponentNode` tree it maintains. Each implementation carries a generated
 * `view` (see `adapter.tsx`) that subscribes to its own node's props and
 * converts them back to the shapes existing views expect, so a data change
 * re-renders exactly the affected component. The surface only dispatches: it
 * hands each `view` its node and a `buildChild` that renders resolved child
 * nodes, falling back to `DeferredChild` recursion over the raw definitions
 * for ids the node layer could not classify, so catalogs without `REF:`
 * child-reference markers keep rendering.
 */

import React, {memo, useCallback, useMemo, useSyncExternalStore} from 'react';
import {
  ComponentContext,
  type ComponentModel,
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

const ResolvedChild = memo(
  ({
    surface,
    id,
    basePath,
    compImpl,
    componentModel,
  }: {
    surface: SurfaceModel<ReactComponentImplementation>;
    id: string;
    basePath: string;
    componentModel: ComponentModel;
    compImpl: ReactComponentImplementation;
  }) => {
    const ComponentToRender = compImpl.render;

    // Create context. Recreate if the componentModel instance changes (e.g. type change recreation).
    const context = useMemo(
      () => new ComponentContext(surface, id, basePath),
      // componentModel is used as a trigger for recreation even if not in the body
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [surface, id, basePath, componentModel],
    );

    const buildChild = useCallback(
      (childId: string, specificPath?: string) => {
        const path = specificPath || context.dataContext.path;
        return (
          <DeferredChild
            key={`${childId}-${path}`}
            surface={surface}
            id={childId}
            basePath={path}
          />
        );
      },
      [surface, context.dataContext.path],
    );

    return <ComponentToRender context={context} buildChild={buildChild} />;
  },
);
ResolvedChild.displayName = 'ResolvedChild';

export const DeferredChild: React.FC<{
  surface: SurfaceModel<ReactComponentImplementation>;
  id: string;
  basePath: string;
}> = memo(({surface, id, basePath}) => {
  // 1. Subscribe specifically to this component's existence
  const store = useMemo(() => {
    let version = 0;
    return {
      subscribe: (cb: () => void) => {
        const unsub1 = surface.componentsModel.onCreated.subscribe(comp => {
          if (comp.id === id) {
            version++;
            cb();
          }
        });
        const unsub2 = surface.componentsModel.onDeleted.subscribe(delId => {
          if (delId === id) {
            version++;
            cb();
          }
        });
        return () => {
          unsub1.unsubscribe();
          unsub2.unsubscribe();
        };
      },
      getSnapshot: () => {
        const comp = surface.componentsModel.get(id);
        // We use instance identity + version as the snapshot to ensure
        // type replacements (e.g. Button -> Text) trigger a re-render.
        return comp ? `${comp.type}-${version}` : `missing-${version}`;
      },
    };
  }, [surface, id]);

  useSyncExternalStore(store.subscribe, store.getSnapshot);

  const componentModel = surface.componentsModel.get(id);

  if (!componentModel) {
    return <div style={{color: 'gray', padding: '4px'}}>[Loading {id}...]</div>;
  }

  const compImpl = surface.catalog.components.get(componentModel.type);

  if (!compImpl) {
    return <div style={{color: 'red'}}>Unknown component: {componentModel.type}</div>;
  }

  return (
    <ResolvedChild
      surface={surface}
      id={id}
      basePath={basePath}
      componentModel={componentModel}
      compImpl={compImpl}
    />
  );
});
DeferredChild.displayName = 'DeferredChild';

/** Renders an implementation that has no `view`: its wrapper binds itself. */
const RenderFallback: React.FC<{
  surface: SurfaceModel<ReactComponentImplementation>;
  node: ComponentNode<ReactComponentImplementation>;
  impl: ReactComponentImplementation;
  buildChild: (id: string, basePath?: string) => React.ReactNode;
}> = ({surface, node, impl, buildChild}) => {
  // See useNodeView: the component can vanish before this render commits.
  const context = useMemo(
    () =>
      surface.componentsModel.get(node.componentId)
        ? new ComponentContext(surface, node.componentId, node.dataPath)
        : undefined,
    [surface, node],
  );
  const Render = impl.render;
  if (!context) {
    return <div style={{color: 'gray', padding: '4px'}}>[Loading {node.componentId}...]</div>;
  }
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
      return <div style={{color: 'red'}}>Unknown component type: {node.type}</div>;
    }
    if (node.isPlaceholder) {
      return <div style={{color: 'gray', padding: '4px'}}>[Loading {node.componentId}...]</div>;
    }
    const impl = node.impl;
    if (!impl) {
      // Type narrowing; unreachable for a resolved node.
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

export const A2uiSurface: React.FC<{
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
