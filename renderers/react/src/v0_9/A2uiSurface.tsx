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
 * `A2uiSurface` owns one `NodeResolver` for its surface, renders the root
 * node's element and portals `NodeContent` into every React host that
 * registers with the surface's `HostRegistry`. The portals keep every
 * component in this one React tree, so providers, error boundaries and
 * Suspense above `A2uiSurface` reach all of them; they are siblings, so React
 * context from a parent catalog component does not reach its children.
 */

import React, {useCallback, useMemo, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {NodeResolver, effect, getValue, peekValue, type SurfaceModel} from '@a2ui/web_core/v0_9';
import {prepareCatalogs} from './catalog/prepare_catalogs';
import {HostRegistry} from './host_registry';
import {ChildElement, LoadingPlaceholder, NodeContent} from './node-view';
import type {ReactCatalogComponent} from './react_component_implementation';

export const A2uiSurface: React.FC<{
  surface: SurfaceModel<ReactCatalogComponent>;
}> = ({surface}) => {
  // The resolver is created inside `subscribe`, which React calls only for
  // committed renders, so a discarded render never constructs one and every
  // resolver is disposed by its own unsubscribe.
  const box = useMemo(
    () => ({resolver: undefined as NodeResolver<ReactCatalogComponent> | undefined}),

    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface],
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      prepareCatalogs(surface);
      const resolver = new NodeResolver(surface, surface.defaultCatalog);
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

  // Hosts are created by whichever parent renders them, a React parent through
  // `WebComponentNode` or a Lit parent through `renderA2uiNode`, so they are
  // not in this component's tree. A connected host registers with its surface
  // together with its node, and the surface portals that node's content into it.
  const registry = HostRegistry.forSurface(surface);
  const hosts = useSyncExternalStore(registry.subscribe, registry.getSnapshot);

  if (!root) {
    return <LoadingPlaceholder componentId="root" />;
  }
  return (
    <>
      <ChildElement node={root} />
      {hosts.map(({host, node}) => createPortal(<NodeContent node={node} />, host, node.id))}
    </>
  );
};
