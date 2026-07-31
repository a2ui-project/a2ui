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

import React, {useSyncExternalStore, memo, useMemo, useCallback, useRef, useEffect} from 'react';
import {
  type SurfaceModel,
  ComponentContext,
  type ComponentModel,
  type A2uiFallbackInfo,
  type A2uiFallbackState,
} from '@a2ui/web_core/v0_9';
import type {ReactComponentImplementation} from './adapter';
import {
  FallbackContext,
  useFallbacks,
  type A2uiFallbacks,
  type A2uiFallbackRenderer,
} from './FallbackContext';

function renderFallback<S extends A2uiFallbackState>(
  renderer: A2uiFallbackRenderer<S> | undefined,
  info: Extract<A2uiFallbackInfo, {state: S}>,
): React.ReactNode {
  if (renderer === undefined) return null;
  return typeof renderer === 'function' ? renderer(info) : renderer;
}

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
            parentComponentType={componentModel.type}
          />
        );
      },
      [surface, context.dataContext.path, componentModel.type],
    );

    return <ComponentToRender context={context} buildChild={buildChild} />;
  },
);
ResolvedChild.displayName = 'ResolvedChild';

export const DeferredChild: React.FC<{
  surface: SurfaceModel<ReactComponentImplementation>;
  id: string;
  basePath: string;
  /** The `type` of the instantiating parent. Absent at the surface root. */
  parentComponentType?: string;
}> = memo(({surface, id, basePath, parentComponentType}) => {
  const fallbacks = useFallbacks();

  // Tracks every unknown type warned about, so re-renders (including
  // StrictMode double-invokes) and type flaps (Nope -> Nope2 -> Nope) do
  // not repeat the warning for this mount. Lazily initialized so a new Set
  // is not allocated on every render.
  const warnedTypesRef = useRef<Set<string> | null>(null);

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
  const compImpl = componentModel ? surface.catalog.components.get(componentModel.type) : undefined;

  // The resolved unknown type, or undefined when the component is pending or
  // resolves to a known implementation. Keys the warn/dispatch effect so a
  // change in the unknown type re-runs it.
  const unknownComponentType = componentModel && !compImpl ? componentModel.type : undefined;

  // Warn + dispatch as a post-commit effect so render stays pure. The Set gate
  // keeps it once-per-distinct-unknown-type for this mount, immune to type
  // flaps (Nope -> Nope2 -> Nope) and StrictMode double-invokes.
  useEffect(() => {
    if (unknownComponentType === undefined) return;
    const warnedTypes = (warnedTypesRef.current ??= new Set());
    if (warnedTypes.has(unknownComponentType)) return;
    warnedTypes.add(unknownComponentType);
    console.warn(`Component implementation not found for type: ${unknownComponentType}`);
    void surface.dispatchError({
      code: 'COMPONENT_NOT_FOUND',
      message: `Component implementation not found for type: ${unknownComponentType}`,
      componentId: id,
      componentType: unknownComponentType,
    });
  }, [surface, id, unknownComponentType]);

  if (!componentModel) {
    return renderFallback(fallbacks?.loading, {
      state: 'loading',
      componentId: id,
      ...(parentComponentType !== undefined ? {parentComponentType} : {}),
    });
  }

  if (!compImpl) {
    return renderFallback(fallbacks?.unknownComponent, {
      state: 'unknownComponent',
      componentId: id,
      componentType: componentModel.type,
      ...(parentComponentType !== undefined ? {parentComponentType} : {}),
    });
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

export const A2uiSurface: React.FC<{
  surface: SurfaceModel<ReactComponentImplementation>;
  /**
   * Optional fallbacks for the `loading` and `unknownComponent` states,
   * delivered via context to nested children. Hoist or memoize this object —
   * a new identity on every render re-evaluates every pending child.
   */
  fallbacks?: A2uiFallbacks;
}> = ({surface, fallbacks}) => {
  // The root component always has ID 'root' and base path '/'
  return (
    <FallbackContext.Provider value={fallbacks}>
      <DeferredChild surface={surface} id="root" basePath="/" />
    </FallbackContext.Provider>
  );
};
