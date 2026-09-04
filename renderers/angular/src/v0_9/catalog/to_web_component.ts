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

import {
  Type,
  Injector,
  EnvironmentInjector,
  ApplicationRef,
  createComponent,
  ComponentRef,
  NgZone,
} from '@angular/core';
import type {ZodTypeAny} from 'zod';
import {ComponentContext, WebComponentImplementation} from '@a2ui/web_core/v0_9';
import {AngularCatalog, type AngularComponentImplementation} from './types';

import {ComponentBinder} from '../core/component-binder.service';

const angularWcCache = new WeakMap<Type<object>, WebComponentImplementation>();
const angularInjectorMap = new WeakMap<Type<object>, Injector>();

/**
 * Registers an Angular Injector for a specific component class in the internal injector map.
 * Internal to the Angular renderer.
 */
export function registerComponentInjector(component: Type<any>, injector: Injector): void {
  angularInjectorMap.set(component, injector);
}

/**
 * Idempotently converts an Angular `@Component` class declaration (`AngularComponentImplementation`)
 * into a W3C Custom Element (`WebComponentImplementation`).
 *
 * This allows custom Angular components to be registered inside the unified `Catalog<WebComponentImplementation>`
 * and rendered seamlessly within any A2UI surface.
 *
 * @param componentImpl The AngularComponentImplementation combining the ComponentApi schema and component class.
 * @param injector The Angular Injector used to instantiate the component.
 * @returns The WebComponentImplementation representation.
 */
export function toWebComponent<Schema extends ZodTypeAny = ZodTypeAny>(
  componentImpl: AngularComponentImplementation<Schema>,
  injector: Injector,
): WebComponentImplementation<Schema> {
  const componentClass = componentImpl.component;
  registerComponentInjector(componentClass, injector);

  if (angularWcCache.has(componentClass)) {
    return angularWcCache.get(componentClass)! as WebComponentImplementation<Schema>;
  }

  let tagName = (componentImpl as {tagName?: string}).tagName;

  if (!tagName) {
    const baseTagName = `a2ui-ng-${componentImpl.name.toLowerCase()}`;
    tagName = baseTagName;
    if (typeof customElements !== 'undefined') {
      let suffix = 1;
      while (customElements.get(tagName)) {
        tagName = `${baseTagName}-${suffix++}`;
      }
    }
  }

  if (typeof customElements !== 'undefined' && !customElements.get(tagName)) {
    class AngularWcHost extends HTMLElement {
      private componentRef?: ComponentRef<object>;
      private appRef?: ApplicationRef;
      private _context?: ComponentContext;
      private updateSub?: {unsubscribe: () => void};
      private _injector?: Injector;

      set injector(inj: Injector) {
        this._injector = inj;
      }

      get injector(): Injector | undefined {
        return this._injector;
      }

      private getResolvedInjector(): Injector | undefined {
        const catalogInjector = (
          this._context?.dataContext?.surface?.catalog as AngularCatalog | undefined
        )?.injector;
        return (
          this._injector ?? catalogInjector ?? angularInjectorMap.get(componentClass) ?? injector
        );
      }

      connectedCallback() {
        this.style.display = 'contents';

        if (!this.componentRef) {
          const currentInjector = this.getResolvedInjector();
          if (!currentInjector) {
            throw new Error(
              `Cannot instantiate Web Component for '${componentImpl.name}': No Angular Injector available.`,
            );
          }
          this.appRef = currentInjector.get(ApplicationRef);
          this.componentRef = createComponent(componentClass, {
            environmentInjector: currentInjector.get(EnvironmentInjector),
            elementInjector: currentInjector,
            hostElement: this,
          });
          this.appRef.attachView(this.componentRef.hostView);
        }

        if (this._context && !this.updateSub) {
          this.subscribeToContext(this._context);
        }

        this.updateContext();
      }

      private subscribeToContext(ctx: ComponentContext) {
        this.updateSub?.unsubscribe();
        const currentInjector = this.getResolvedInjector();
        const ngZone = currentInjector?.get(NgZone, null);
        this.updateSub = ctx.componentModel.onUpdated.subscribe(() => {
          if (ngZone) {
            ngZone.run(() => {
              this.updateContext();
            });
          } else {
            this.updateContext();
          }
        });
      }

      set context(ctx: ComponentContext) {
        this._context = ctx;
        this.subscribeToContext(ctx);
        this.updateContext();
      }

      get context() {
        return this._context!;
      }

      private updateContext() {
        if (!this.componentRef || !this._context) return;
        const currentInjector = this.getResolvedInjector();
        if (!currentInjector) return;
        const binder = currentInjector.get(ComponentBinder);
        const boundProps = binder.bind(this._context);
        try {
          this.componentRef.setInput('props', boundProps);
        } catch {
          // Component may not accept props input
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
        if (this.updateSub) {
          this.updateSub.unsubscribe();
          this.updateSub = undefined;
        }
        if (this.componentRef) {
          this.appRef?.detachView(this.componentRef.hostView);
          this.componentRef.destroy();
          this.componentRef = undefined;
          this.appRef = undefined;
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
