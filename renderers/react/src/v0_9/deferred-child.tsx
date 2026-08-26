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
 * Compatibility fallback for child references the resolver cannot classify:
 * a schema property that lost its component-id marker. `DeferredChild`
 * resolves such an id the way the pre-node-layer surface did, subscribing to
 * the components model directly, so late arrival, deletion and re-addition,
 * and type replacement all keep working. Every use reports
 * `UNMARKED_CHILD_REFERENCE` through the surface's error channel once per
 * reference; the fallback and the `DeferredChild` export are deprecated and
 * will be removed once catalogs have moved to `componentId()`/`childList()`.
 */

import React, {memo, useCallback, useEffect, useMemo, useSyncExternalStore} from 'react';
import {ComponentContext, type ComponentModel, type SurfaceModel} from '@a2ui/web_core/v0_9';
import type {ReactComponentImplementation} from './adapter';
import {LoadingPlaceholder} from './node-view';

/** Deprecation reports already dispatched, per surface. */
const reportedFallbacks = new WeakMap<SurfaceModel<ReactComponentImplementation>, Set<string>>();

/**
 * Renders an unmarked child reference through {@link DeferredChild} and
 * reports the deprecation once per (id, path), from an effect so onError
 * subscribers may set state.
 */
export const DeprecatedUnmarkedReference: React.FC<{
  surface: SurfaceModel<ReactComponentImplementation>;
  id: string;
  basePath: string;
}> = ({surface, id, basePath}) => {
  useEffect(() => {
    let seen = reportedFallbacks.get(surface);
    if (!seen) {
      seen = new Set();
      reportedFallbacks.set(surface, seen);
    }
    const key = JSON.stringify([id, basePath]);
    if (!seen.has(key)) {
      seen.add(key);
      void surface.dispatchError({
        code: 'UNMARKED_CHILD_REFERENCE',
        message:
          `Child reference '${id}' rendered through the compatibility fallback: the catalog ` +
          `schema does not mark the referencing property as a component id. Use componentId() ` +
          `or childList() from @a2ui/web_core; calling .describe() on ComponentIdSchema drops ` +
          `the marker. This fallback will be removed in a future release.`,
      });
    }
  }, [surface, id, basePath]);
  return <DeferredChild surface={surface} id={id} basePath={basePath} />;
};

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

/**
 * @deprecated Rendering path for child references without a schema marker;
 * mark the property with `componentId()` or `childList()` instead. Removed
 * in a future release.
 */
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
    return <LoadingPlaceholder componentId={id} />;
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
