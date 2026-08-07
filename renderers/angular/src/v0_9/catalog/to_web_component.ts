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

import {
  Type,
  Injector,
  EnvironmentInjector,
  ApplicationRef,
  createComponent,
  ComponentRef,
} from '@angular/core';
import type {ZodTypeAny} from 'zod';
import {ComponentContext, WebComponentImplementation} from '@a2ui/web_core/v0_9';
import type {AngularComponentImplementation} from './types';

const angularWcCache = new WeakMap<Type<object>, WebComponentImplementation>();

/**
 * Idempotently converts an Angular `@Component` class declaration (`AngularComponentImplementation`)
 * into a W3C Custom Element (`WebComponentImplementation`).
 *
 * This allows custom Angular components to be registered inside the unified `Catalog<WebComponentImplementation>`
 * and rendered seamlessly within any A2UI surface.
 *
 * @param componentImpl The AngularComponentImplementation combining the ComponentApi schema and component class.
 * @param injector Angular Injector used to create component instances.
 * @returns The WebComponentImplementation representation.
 */
export function toWebComponent<Schema extends ZodTypeAny = ZodTypeAny>(
  componentImpl: AngularComponentImplementation<Schema>,
  injector: Injector,
): WebComponentImplementation<Schema> {
  const componentClass = componentImpl.component;

  if (angularWcCache.has(componentClass)) {
    return angularWcCache.get(componentClass)! as WebComponentImplementation<Schema>;
  }

  const tagName = componentImpl.tagName || `a2ui-ng-${componentImpl.name.toLowerCase()}`;

  if (!customElements.get(tagName)) {
    class AngularWcHost extends HTMLElement {
      private componentRef?: ComponentRef<object>;
      private _context?: ComponentContext;

      connectedCallback() {
        this.style.display = 'contents';

        if (!this.componentRef) {
          const appRef = injector.get(ApplicationRef);
          this.componentRef = createComponent(componentClass, {
            environmentInjector: injector.get(EnvironmentInjector),
            elementInjector: injector,
            hostElement: this,
          });
          appRef.attachView(this.componentRef.hostView);
        }
        this.updateContext();
      }

      set context(ctx: ComponentContext) {
        this._context = ctx;
        this.updateContext();
      }

      get context() {
        return this._context!;
      }

      private updateContext() {
        if (!this.componentRef || !this._context) return;
        try {
          this.componentRef.setInput('context', this._context);
        } catch {
          // Component may not accept context input
        }
        try {
          this.componentRef.setInput('surfaceId', this._context.dataContext.surface.id);
        } catch {
          // Optional input not defined on component
        }
        try {
          this.componentRef.setInput('componentId', this._context.componentModel.id);
        } catch {
          // Optional input not defined on component
        }
        try {
          this.componentRef.setInput('dataContextPath', this._context.dataContext.path);
        } catch {
          // Optional input not defined on component
        }
        this.componentRef.changeDetectorRef.detectChanges();
      }

      disconnectedCallback() {
        if (this.componentRef) {
          const appRef = injector.get(ApplicationRef);
          appRef.detachView(this.componentRef.hostView);
          this.componentRef.destroy();
          this.componentRef = undefined;
        }
      }
    }

    customElements.define(tagName, AngularWcHost);
  }

  const implementation: WebComponentImplementation<Schema> & {component?: Type<object>} = {
    name: componentImpl.name,
    schema: componentImpl.schema,
    tagName,
    component: componentClass,
  };

  angularWcCache.set(componentClass, implementation);
  return implementation;
}
