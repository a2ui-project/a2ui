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

import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import type {ComponentContext} from '@a2ui/web_core/v0_9';
import type {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import type {ReactComponentImplementation} from './adapter';
import {A2uiNodeById, NodeSurfaceContext} from './node-view';

/**
 * Wraps a `ReactComponentImplementation` as a `WebComponentImplementation` while
 * preserving its native React `.render` and `.view` properties.
 *
 * This allows custom React components to be hosted seamlessly inside Universal
 * Custom Element containers (which render children via `<tag .context=${ctx}>`)
 * as well as directly inside `<A2uiSurface>`.
 */
export function toWebComponent(
  impl: ReactComponentImplementation,
): ReactComponentImplementation & WebComponentImplementation {
  const existing = impl as Partial<WebComponentImplementation>;
  if (existing.tagName && existing.element) {
    return impl as ReactComponentImplementation & WebComponentImplementation;
  }

  const slug = impl.name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9-]/g, '-')
    .toLowerCase();
  const tagName = `a2ui-react-${slug}`;

  class ReactCustomElement extends HTMLElement {
    private _context: ComponentContext | null = null;
    private _root: Root | null = null;
    private _mountPoint: HTMLDivElement | null = null;

    set context(val: ComponentContext | null) {
      this._context = val;
      this._render();
    }

    get context(): ComponentContext | null {
      return this._context;
    }

    connectedCallback(): void {
      this._render();
    }

    disconnectedCallback(): void {
      const root = this._root;
      this._root = null;
      this._mountPoint = null;
      if (root) {
        queueMicrotask(() => root.unmount());
      }
    }

    private _render(): void {
      if (!this.isConnected || !this._context) {
        return;
      }
      if (!this._root || !this._mountPoint) {
        const mountPoint = document.createElement('div');
        mountPoint.style.display = 'contents';
        this.replaceChildren(mountPoint);
        this._mountPoint = mountPoint;
        this._root = createRoot(mountPoint);
      }
      const context = this._context;
      const surface = context.dataContext.surface;
      const Render = impl.render;
      const buildChild = (childId: string, basePath?: string): React.ReactNode => {
        const resolvedPath = basePath ?? context.dataContext.path;
        return (
          <A2uiNodeById
            key={JSON.stringify([childId, resolvedPath])}
            surface={surface}
            id={childId}
            basePath={resolvedPath}
          />
        );
      };

      this._root.render(
        <NodeSurfaceContext.Provider value={surface}>
          <Render context={context} buildChild={buildChild} />
        </NodeSurfaceContext.Provider>,
      );
    }
  }

  return {
    ...impl,
    tagName,
    element: ReactCustomElement,
  };
}
