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
import {ComponentContext} from '@a2ui/web_core/v0_9';
import {WebComponentImplementation} from '@a2ui/web_core/v0_9/universal';
import type {AngularComponentImplementation} from './types';

import {ComponentBinder} from '../core/component-binder.service';
import type {CatalogComponentInstance} from '../core/catalog_component_instance';

const angularWcCache = new WeakMap<Type<object>, WebComponentImplementation>();
const tagNameCounts = new Map<string, number>();

let defaultInjector: Injector | undefined;

/**
 * Sets the Angular `Injector` used by wrapped Angular components whose host element was not
 * given one explicitly.
 *
 * Wrapped components are created at catalog definition time, before any injector exists, so the
 * injector is resolved when the element connects: the element's own `injector` property wins
 * (the Angular `ComponentHostComponent` sets it on the elements it mounts), and this default is
 * the fallback for elements created by universal container components. `A2uiRendererService`
 * registers its injector here on construction.
 *
 * @param injector The injector to use as a fallback, or `undefined` to clear it.
 */
export function setDefaultUniversalInjector(injector: Injector | undefined): void {
  defaultInjector = injector;
}

/**
 * Clears the default injector if it is still `injector`, so that a destroyed injector is not
 * handed to elements connected later.
 */
export function clearDefaultUniversalInjector(injector: Injector): void {
  if (defaultInjector === injector) {
    defaultInjector = undefined;
  }
}

/**
 * Computes a unique custom element tag name of the form `a2ui-ng-<name>`.
 *
 * Names are disambiguated with an incrementing suffix (`a2ui-ng-<name>-2`, ...) so that two
 * different Angular components sharing a component name get distinct tags.
 */
function computeTagName(name: string): string {
  const baseTagName = `a2ui-ng-${name.toLowerCase()}`;
  const count = (tagNameCounts.get(baseTagName) ?? 0) + 1;
  tagNameCounts.set(baseTagName, count);
  return count === 1 ? baseTagName : `${baseTagName}-${count}`;
}

/**
 * Custom Element host that mounts and manages the lifecycle of an Angular component
 * inside the DOM for universal A2UI rendering.
 */
abstract class AngularWcHost extends HTMLElement {
  /** The Angular component class this element mounts. */
  protected abstract readonly componentClass: Type<CatalogComponentInstance>;

  private componentRef?: ComponentRef<object>;
  private appRef?: ApplicationRef;
  private binder?: ComponentBinder;
  private ngZone?: NgZone | null;
  private _context?: ComponentContext;
  private updateSub?: {unsubscribe: () => void};
  private _injector?: Injector;

  set injector(inj: Injector | undefined) {
    this._injector = inj;
  }

  get injector(): Injector | undefined {
    return this._injector ?? defaultInjector;
  }

  connectedCallback() {
    this.style.display = 'contents';

    if (!this.componentRef) {
      const injector = this.injector;
      if (!injector) {
        throw new Error(
          `Cannot instantiate Web Component '${this.tagName.toLowerCase()}': no Angular Injector ` +
            `available. Set the element's 'injector' property or configure the renderer with ` +
            `'provideA2Ui'.`,
        );
      }
      this.appRef = injector.get(ApplicationRef);
      this.binder = injector.get(ComponentBinder);
      this.ngZone = injector.get(NgZone, null);
      this.componentRef = createComponent(this.componentClass, {
        environmentInjector: injector.get(EnvironmentInjector),
        elementInjector: injector,
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
    this.updateSub = ctx.componentModel.onUpdated.subscribe(() => {
      if (this.ngZone) {
        this.ngZone.run(() => {
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

  get context(): ComponentContext {
    return this._context!;
  }

  private updateContext() {
    if (!this.componentRef || !this.binder || !this._context) return;

    const boundProps = this.binder.bind(this._context);

    this.componentRef.setInput('props', boundProps);
    this.componentRef.setInput('surfaceId', this._context.dataContext.surface.id);
    this.componentRef.setInput('componentId', this._context.componentModel.id);
    this.componentRef.setInput('dataContextPath', this._context.dataContext.path);

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
      this.binder = undefined;
      this.ngZone = undefined;
    }
  }
}

/**
 * Wraps an Angular `@Component` class declaration (`AngularComponentImplementation`) into a
 * W3C Custom Element (`WebComponentImplementation`).
 *
 * The returned implementation carries a generated `a2ui-ng-<name>` tag and an element class that
 * mounts the Angular component when connected. The element is not defined in the
 * `customElements` registry here; renderers define it on demand with `registerUniversalElement`
 * right before rendering it, like any other `WebComponentImplementation`.
 *
 * Calling this twice with the same component class returns the same implementation.
 *
 * @param componentImpl The AngularComponentImplementation combining the ComponentApi schema and component class.
 * @returns The WebComponentImplementation representation.
 */
export function toWebComponent(
  componentImpl: AngularComponentImplementation,
): WebComponentImplementation {
  const componentClass = componentImpl.component;

  const cached = angularWcCache.get(componentClass);
  if (cached) {
    return cached;
  }

  const tagName = computeTagName(componentImpl.name);
  const element = class extends AngularWcHost {
    protected override readonly componentClass = componentClass;
  };

  const implementation: WebComponentImplementation = {
    name: componentImpl.name,
    schema: componentImpl.schema,
    tagName,
    element,
  };

  angularWcCache.set(componentClass, implementation);
  return implementation;
}
