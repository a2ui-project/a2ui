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
const tagToComponentClassMap = new Map<string, Type<any>>();

/**
 * Registers an Angular Injector for a specific component class in the internal injector map.
 * Internal to the Angular renderer.
 */
function registerComponentInjector(component: Type<any>, injector: Injector): void {
  angularInjectorMap.set(component, injector);
}

/**
 * Computes a unique custom element tag name for an Angular component implementation.
 *
 * If `tagName` is specified on `componentImpl`, it is returned directly. Otherwise, a tag name
 * of the form `a2ui-ng-<name>` is generated, disambiguating with an incrementing suffix if
 * already registered in the DOM's `customElements` registry.
 *
 * @param componentImpl The Angular component implementation.
 * @returns A valid custom element tag name.
 */
function computeTagName(componentImpl: AngularComponentImplementation<any>): string {
  const baseTagName = `a2ui-ng-${componentImpl.name.toLowerCase()}`;
  if (typeof customElements === 'undefined') {
    return componentImpl.tagName ?? baseTagName;
  }
  if (componentImpl.tagName && !customElements.get(componentImpl.tagName)) {
    return componentImpl.tagName;
  }
  let tagName = componentImpl.tagName ?? baseTagName;
  let suffix = 1;
  while (customElements.get(tagName)) {
    tagName = `${baseTagName}-${suffix++}`;
  }
  return tagName;
}

/**
 * Custom Element host that mounts and manages the lifecycle of an Angular component
 * inside the DOM for universal A2UI rendering.
 */
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

  private getComponentClass(): Type<any> | undefined {
    return tagToComponentClassMap.get(this.tagName.toLowerCase());
  }

  private getResolvedInjector(componentClass?: Type<any>): Injector | undefined {
    const catalogInjector = (
      this._context?.dataContext?.surface?.catalog as AngularCatalog | undefined
    )?.injector;
    return (
      this._injector ??
      catalogInjector ??
      (componentClass ? angularInjectorMap.get(componentClass) : undefined)
    );
  }

  connectedCallback() {
    this.style.display = 'contents';

    const componentClass = this.getComponentClass();
    if (!componentClass) {
      throw new Error(
        `Cannot instantiate Web Component for '${this.tagName}': No Angular component class registered.`,
      );
    }

    if (!this.componentRef) {
      const currentInjector = this.getResolvedInjector(componentClass);
      if (!currentInjector) {
        throw new Error(
          `Cannot instantiate Web Component for '${componentClass.name}': No Angular Injector available.`,
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
    const componentClass = this.getComponentClass();
    const currentInjector = this.getResolvedInjector(componentClass);
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

  get context(): ComponentContext {
    return this._context!;
  }

  private updateContext() {
    if (!this.componentRef || !this._context) return;
    const componentClass = this.getComponentClass();
    const currentInjector = this.getResolvedInjector(componentClass);
    if (!currentInjector || !componentClass) return;

    const binder = currentInjector.get(ComponentBinder);
    const boundProps = binder.bind(this._context);

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
    }
  }
}

/**
 * Registers the Custom Element for an Angular component with the customElements registry.
 *
 * @param tagName The custom element tag name.
 * @param componentClass The Angular component class.
 * @param injector The Angular Injector used to instantiate the component.
 */
function registerWebComponent(
  tagName: string,
  componentClass: Type<any>,
  injector: Injector,
): void {
  if (typeof customElements === 'undefined') {
    throw new Error(
      `Cannot register Custom Element '${tagName}': 'customElements' is not supported in this environment.`,
    );
  }

  if (customElements.get(tagName)) {
    throw new Error(
      `Cannot register Custom Element '${tagName}': Tag name is already defined in customElements registry.`,
    );
  }

  tagToComponentClassMap.set(tagName.toLowerCase(), componentClass);
  registerComponentInjector(componentClass, injector);
  customElements.define(tagName, class extends AngularWcHost {});
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
  if (typeof customElements === 'undefined') {
    throw new Error(
      `Cannot convert Angular component '${componentImpl.name}' to Web Component: 'customElements' is not supported in this environment.`,
    );
  }

  const componentClass = componentImpl.component;

  if (angularWcCache.has(componentClass)) {
    return angularWcCache.get(componentClass)! as WebComponentImplementation<Schema>;
  }

  const tagName = computeTagName(componentImpl);
  registerWebComponent(tagName, componentClass, injector);

  const implementation: WebComponentImplementation<Schema> = {
    name: componentImpl.name,
    schema: componentImpl.schema,
    tagName,
  };

  angularWcCache.set(componentClass, implementation);
  return implementation;
}
