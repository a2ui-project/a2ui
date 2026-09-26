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
  Injector,
  EnvironmentInjector,
  ApplicationRef,
  createComponent,
  ComponentRef,
  NgZone,
} from '@angular/core';
import {ComponentContext} from '@a2ui/web_core/v0_9';
import type {AngularComponentImplementation} from './types';

import {ComponentBinder} from '../core/component-binder.service';

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
 * Custom Element host that mounts and manages the lifecycle of an Angular component inside the
 * DOM for universal A2UI rendering.
 *
 * The Angular component to mount is resolved when the element connects, from the catalog entry of
 * the element's `context` (the entry that owns this element), so `context` must be set before the
 * element is attached to the document. `customElements` refuses to define one class under two tag
 * names, so {@link toWebComponent} derives an empty subclass per Angular component.
 */
export class AngularWcHost extends HTMLElement {
  private componentRef?: ComponentRef<object>;
  private appRef?: ApplicationRef;
  private binder?: ComponentBinder;
  private ngZone?: NgZone | null;
  private _context?: ComponentContext;
  private contextSubscription?: {unsubscribe: () => void};
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
      const context = this._context;
      if (!context) {
        throw new Error(
          `Cannot instantiate Web Component '${this.tagName.toLowerCase()}': 'context' must be ` +
            `set before the element is connected.`,
        );
      }
      const type = context.componentModel.type;
      // The catalog entry that owns this element pairs it with the Angular component to mount.
      const entry = context.dataContext.surface.defaultCatalog.components.get(type) as
        | AngularComponentImplementation
        | undefined;
      if (typeof entry?.component !== 'function') {
        throw new Error(
          `Cannot instantiate Web Component '${this.tagName.toLowerCase()}': catalog entry ` +
            `'${type}' has no Angular component.`,
        );
      }
      this.appRef = injector.get(ApplicationRef);
      this.binder = injector.get(ComponentBinder);
      this.ngZone = injector.get(NgZone, null);
      this.componentRef = createComponent(entry.component, {
        environmentInjector: injector.get(EnvironmentInjector),
        elementInjector: injector,
        hostElement: this,
      });
      this.appRef.attachView(this.componentRef.hostView);
    }

    // `disconnectedCallback` drops the subscription and a moved element reconnects without
    // `context` being set again, so (re)subscribe on every connect. `subscribeToContext`
    // unsubscribes first, so this never subscribes twice.
    this.subscribeToContext(this.context);
    this.updateContext();
  }

  private subscribeToContext(ctx: ComponentContext) {
    this.contextSubscription?.unsubscribe();
    this.contextSubscription = ctx.componentModel.onUpdated.subscribe(() => {
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
    this.contextSubscription?.unsubscribe();
    this.contextSubscription = undefined;
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
