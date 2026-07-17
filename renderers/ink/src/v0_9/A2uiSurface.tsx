/**
 * Copyright 2026 kokoro-ele
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

import React, {useSyncExternalStore, memo, useMemo, useCallback} from 'react';
import {Text} from 'ink';
import {type SurfaceModel, ComponentContext, type ComponentModel} from '@a2ui/web_core/v0_9';
import type {InkComponentImplementation} from './adapter.js';

const ResolvedChild = memo(
  ({
    surface,
    id,
    basePath,
    compImpl,
    componentModel,
  }: {
    surface: SurfaceModel<InkComponentImplementation>;
    id: string;
    basePath: string;
    componentModel: ComponentModel;
    compImpl: InkComponentImplementation;
  }) => {
    const ComponentToRender = compImpl.render;

    const context = useMemo(
      () => new ComponentContext(surface, id, basePath),
      // componentModel triggers recreation when the model instance is replaced
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
  surface: SurfaceModel<InkComponentImplementation>;
  id: string;
  basePath: string;
}> = memo(({surface, id, basePath}) => {
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
        return comp ? `${comp.type}-${version}` : `missing-${version}`;
      },
    };
  }, [surface, id]);

  useSyncExternalStore(store.subscribe, store.getSnapshot);

  const componentModel = surface.componentsModel.get(id);

  if (!componentModel) {
    return <Text dimColor>[Loading {id}...]</Text>;
  }

  const compImpl = surface.catalog.components.get(componentModel.type);

  if (!compImpl) {
    return <Text color="red">Unknown component: {componentModel.type}</Text>;
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

/** Root host: renders the surface starting at component id `root`. */
export const A2uiSurface: React.FC<{surface: SurfaceModel<InkComponentImplementation>}> = ({
  surface,
}) => {
  return <DeferredChild surface={surface} id="root" basePath="/" />;
};
