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
 * `A2uiSurface` owns one `NodeResolver` for the surface it is given,
 * subscribes to the resolved root node and renders its element; it also
 * portals content into the surface's React hosts that no React-rendered
 * element owns. Everything below the root, including dispatch to each
 * implementation and child reference resolution, lives in `node-view.tsx`.
 */

import React, {useCallback, useLayoutEffect, useMemo, useSyncExternalStore} from 'react';
import {NodeResolver, effect, getValue, peekValue, type SurfaceModel} from '@a2ui/web_core/v0_9';
import {setMarkdownRenderer} from '@a2ui/web_core/v0_9/basic_catalog';
import {prepareCatalogs} from './catalog/prepare_catalogs';
import {ChildElement, HostedChildren, LoadingPlaceholder} from './node-view';
import type {ReactCatalogComponent} from './react_component_implementation';
import {useMarkdownRenderer} from './markdown-context';

export const A2uiSurface: React.FC<{
  surface: SurfaceModel<ReactCatalogComponent>;
}> = ({surface}) => {
  // web_core's basic catalog reads its markdown renderer from a module-level
  // slot. A layout effect sets it during commit, so it is in place before any
  // Lit element in the surface updates. A surface without a renderer leaves
  // the slot alone, so one the host registered itself stays in effect.
  const markdownRenderer = useMarkdownRenderer();
  useLayoutEffect(() => {
    if (markdownRenderer) {
      setMarkdownRenderer(markdownRenderer);
    }
  }, [markdownRenderer]);

  // The resolver is created inside subscribe, which React calls only for
  // committed renders: a render that is discarded (concurrent mode,
  // Suspense) never constructs one, and every constructed resolver is
  // disposed by its own unsubscribe. StrictMode's double mount creates and
  // disposes two in turn.
  // The factory reads nothing; the dependency exists to reset the box when
  // the surface is swapped.
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

  if (!root) {
    return <LoadingPlaceholder componentId="root" />;
  }
  // A React host of this surface with no React-rendered element above it
  // (one created outside the surface's tree) gets its content from here.
  return (
    <>
      <ChildElement node={root} />
      <HostedChildren surface={surface} owner={null} />
    </>
  );
};
