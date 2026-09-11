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

import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import type {ZodTypeAny} from 'zod';
import {
  type A2uiWebComponentElement,
  ComponentContext,
  type WebComponentImplementation,
} from '@a2ui/web_core/v0_9';
import {isReactComponentImplementation} from '../is_react_component_implementation';
import type {ReactComponentImplementation} from '../react_component_implementation';
import {WebComponentNode} from '../web_component_node';

const reactWcCache = new WeakMap<React.FC<unknown>, WebComponentImplementation>();

/**
 * Idempotently converts a React component implementation (`ReactComponentImplementation`)
 * into a W3C Custom Element (`WebComponentImplementation`).
 *
 * This allows custom React components to be registered inside the unified `Catalog<WebComponentImplementation>`
 * and rendered seamlessly within any A2UI surface.
 *
 * @param componentImpl The ReactComponentImplementation combining the ComponentApi schema and React render component.
 * @returns The WebComponentImplementation representation.
 */
export function toWebComponent<Schema extends ZodTypeAny = ZodTypeAny>(
  componentImpl: ReactComponentImplementation<Schema>,
): WebComponentImplementation<Schema> {
  const renderFn = componentImpl.render as React.FC<unknown>;
  if (reactWcCache.has(renderFn)) {
    return reactWcCache.get(renderFn)! as WebComponentImplementation<Schema>;
  }

  let tagName = componentImpl.tagName || `a2ui-react-${componentImpl.name.toLowerCase()}`;

  if (typeof customElements !== 'undefined') {
    let suffix = 1;
    const baseTagName = tagName;
    while (customElements.get(tagName)) {
      tagName = `${baseTagName}-${suffix++}`;
    }

    if (!customElements.get(tagName)) {
      class ReactWcHost extends HTMLElement implements A2uiWebComponentElement {
        private _root: Root | null = null;
        private _context?: ComponentContext;

        connectedCallback() {
          this.style.display = 'contents';

          if (!this._root) {
            this._root = createRoot(this);
          }

          this.renderComponent();
        }

        set context(ctx: ComponentContext) {
          this._context = ctx;
          this.renderComponent();
        }

        get context(): ComponentContext | undefined {
          return this._context;
        }

        private buildChild = (childId: string, specificPath?: string): React.ReactNode => {
          const path = specificPath || this._context?.dataContext.path;
          if (!this._context) return null;
          const comp = this._context.dataContext.surface.componentsModel.get(childId);
          if (!comp) return null;
          const impl = this._context.dataContext.surface.catalog.components.get(comp.type);
          if (!impl) return null;

          const childCtx = new ComponentContext(
            this._context.dataContext.surface,
            childId,
            path || '/',
          );

          // Every React implementation carries a tag name, so the question is
          // what the implementation is, not whether it has a tag.
          if (isReactComponentImplementation(impl)) {
            const NativeRender = impl.render;
            return <NativeRender context={childCtx} buildChild={this.buildChild} />;
          }

          const {tagName: childTagName} = impl as WebComponentImplementation;
          if (!childTagName) return null;
          return <WebComponentNode tagName={childTagName} context={childCtx} />;
        };

        private renderComponent() {
          if (!this._root || !this._context) return;
          const RenderComponent = componentImpl.render;
          this._root.render(
            <RenderComponent context={this._context} buildChild={this.buildChild} />,
          );
        }

        disconnectedCallback() {
          queueMicrotask(() => {
            if (!this.isConnected && this._root) {
              this._root.unmount();
              this._root = null;
            }
          });
        }
      }

      customElements.define(tagName, ReactWcHost);
    }
  }

  const implementation: WebComponentImplementation<Schema> = {
    name: componentImpl.name,
    schema: componentImpl.schema,
    tagName,
  };

  reactWcCache.set(renderFn, implementation);
  return implementation;
}
