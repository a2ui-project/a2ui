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
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  Type,
  inject,
  input,
  effect,
  signal,
  NgZone,
} from '@angular/core';
import {NgComponentOutlet} from '@angular/common';
import {ComponentContext, ComponentModel, SurfaceModel, Subscription} from '@a2ui/web_core/v0_9';
import {
  isWebComponentImplementation,
  registerUniversalElement,
  type WebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import {A2uiRendererService} from './a2ui-renderer.service';
import {ComponentBinder} from './component-binder.service';
import {BoundProperty} from './types';

import type {AngularComponentImplementation} from '../catalog/types';
import {CatalogComponentInstance} from './catalog_component_instance';

interface UniversalComponentHostElement extends HTMLElement {
  context: ComponentContext;
  injector?: Injector;
}

/**
 * Dynamically renders an A2UI component as defined in the current surface model.
 *
 * This component acts as a bridge between the A2UI surface model and UI components.
 * It can render both native Angular `@Component` implementations (via `NgComponentOutlet`)
 * and universal W3C Web Components (by instantiating and appending the custom element tag).
 *
 * Usually, you'll use the higher-level {@link SurfaceComponent} which automatically
 * sets up a host for the 'root' component.
 */
@Component({
  selector: 'a2ui-v09-component-host',
  imports: [NgComponentOutlet],
  host: {
    style: 'display: contents;',
  },
  // The quotes around the input keys passed to *ngComponentOutlet are critical to survive Closure
  // minification. Prettier keeps them (`quoteProps: "preserve"` in the root `.prettierrc`).
  template: `
    @if (componentType()) {
      <ng-container
        *ngComponentOutlet="
          componentType()!;
          inputs: {
            props: props(),
            surfaceId: surfaceId(),
            componentId: resolvedComponentId,
            dataContextPath: resolvedDataContextPath,
          }
        "
      ></ng-container>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComponentHostComponent {
  /** The key of the component to render, either an ID string or an object with ID and basePath. Defaults to 'root'. */
  componentKey = input<string | {id: string; basePath: string}>('root');

  /** The unique identifier of the surface this component belongs to. */
  surfaceId = input.required<string>();

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly rendererService = inject(A2uiRendererService);
  private readonly binder = inject(ComponentBinder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);

  protected readonly componentType = signal<Type<CatalogComponentInstance> | null>(null);
  protected readonly props = signal<Record<string, BoundProperty>>({});
  private context?: ComponentContext;
  private mountedWcEl: UniversalComponentHostElement | null = null;

  protected resolvedComponentId: string = '';
  protected resolvedDataContextPath: string = '/';

  private propsSub?: Subscription;
  private createSub?: Subscription;
  private surfaceSub?: Subscription;

  constructor() {
    effect(() => {
      const key = this.componentKey();
      const surfaceId = this.surfaceId();
      if (key && surfaceId) {
        this.resetState();
        this.setupComponent(key, surfaceId);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.resetState();
    });
  }

  private setupComponent(key: string | {id: string; basePath: string}, surfaceId: string) {
    this.resetState();

    const surface = this.rendererService.surfaceGroup?.getSurface(surfaceId);

    if (!surface) {
      console.warn(`Surface ${surfaceId} not found. Waiting for it...`);
      this.surfaceSub?.unsubscribe();
      let unsubscribed = false;
      const sub = this.rendererService.surfaceGroup?.onSurfaceCreated?.subscribe(s => {
        if (s.id === surfaceId) {
          unsubscribed = true;
          if (this.surfaceSub) {
            this.surfaceSub.unsubscribe();
            this.surfaceSub = undefined;
          }
          this.ngZone.run(() => {
            this.setupComponent(key, surfaceId);
          });
        }
      });
      if (sub) {
        this.surfaceSub = sub;
        if (unsubscribed) {
          this.surfaceSub.unsubscribe();
          this.surfaceSub = undefined;
        }
      }
      return;
    }

    let id: string;
    let basePath: string;

    if (typeof key === 'object' && key !== null && 'id' in key) {
      id = key.id;
      basePath = key.basePath || '/';
    } else {
      id = key;
      basePath = '/';
    }

    this.resolvedComponentId = id;

    const componentModel = surface.componentsModel.get(id);

    if (!componentModel) {
      console.warn(`Component ${id} not found in surface ${surfaceId}. Waiting for it...`);

      const sub = surface.componentsModel.onCreated.subscribe(comp => {
        if (comp.id === id) {
          this.initializeComponent(surface, comp, id, basePath);
          sub.unsubscribe();
        }
      });
      this.createSub = sub;
      return;
    }

    this.initializeComponent(surface, componentModel, id, basePath);
  }

  private initializeComponent(
    surface: SurfaceModel<AngularComponentImplementation>,
    componentModel: ComponentModel,
    id: string,
    basePath: string,
  ): void {
    // Resolve component from the surface's catalog
    const catalog = surface.defaultCatalog;
    const componentImpl = catalog.components.get(componentModel.type);

    if (!componentImpl) {
      console.error(`Component type "${componentModel.type}" not found in catalog "${catalog.id}"`);
      return;
    }

    this.context = new ComponentContext(surface, id, basePath);
    this.resolvedDataContextPath = this.context.dataContext.path;

    // Entries from `createComponentImplementation` carry both an Angular component and a Custom
    // Element; the flag picks which one to mount. Web Component-only entries render only with the
    // flag on (their placeholder `component` reports the misconfiguration otherwise).
    if (
      this.rendererService.useUniversalComponents &&
      isWebComponentImplementation(componentImpl)
    ) {
      this.setupWebComponent(componentImpl, surface, componentModel, id, basePath);
    } else {
      this.setupAngularComponent(componentImpl.component, componentModel);
    }
  }

  private setupAngularComponent(
    componentClass: Type<CatalogComponentInstance>,
    componentModel: ComponentModel,
  ): void {
    if (this.mountedWcEl) {
      this.mountedWcEl.remove();
      this.mountedWcEl = null;
    }
    this.componentType.set(componentClass);
    this.updateProps();

    this.propsSub = componentModel.onUpdated.subscribe(() => {
      this.ngZone.run(() => this.updateProps());
    });
  }

  /** Re-binds the props of the mounted Angular component and schedules change detection. */
  private updateProps(): void {
    this.props.set(this.binder.bind(this.context!));
    this.cdr.markForCheck();
  }

  private setupWebComponent(
    implementation: WebComponentImplementation,
    surface: SurfaceModel<AngularComponentImplementation>,
    componentModel: ComponentModel,
    id: string,
    basePath: string,
  ): void {
    this.componentType.set(null);
    this.props.set({});

    registerUniversalElement(implementation);
    const tagName = implementation.tagName;

    if (this.mountedWcEl && this.mountedWcEl.tagName.toLowerCase() === tagName.toLowerCase()) {
      this.mountedWcEl.injector = this.injector;
      this.mountedWcEl.context = this.context!;
    } else {
      if (this.mountedWcEl) {
        this.mountedWcEl.remove();
        this.mountedWcEl = null;
      }
      const el = document.createElement(tagName) as UniversalComponentHostElement;
      el.injector = this.injector;
      el.context = this.context!;
      this.mountedWcEl = el;
      this.elementRef.nativeElement.appendChild(el);
    }

    this.propsSub = componentModel.onUpdated.subscribe(() => {
      this.ngZone.run(() => {
        if (this.mountedWcEl) {
          this.mountedWcEl.context = new ComponentContext(surface, id, basePath);
        }
      });
    });
  }

  /**
   * Resets the component host state, unsubscribing from active subscriptions
   * and clearing component properties to avoid rendering stale data while
   * a new component is being loaded.
   */
  private resetState(): void {
    this.propsSub?.unsubscribe();
    this.propsSub = undefined;
    this.createSub?.unsubscribe();
    this.createSub = undefined;
    this.surfaceSub?.unsubscribe();
    this.surfaceSub = undefined;

    this.componentType.set(null);
    this.props.set({});
    this.resolvedDataContextPath = '/';

    if (this.mountedWcEl) {
      this.mountedWcEl.remove();
      this.mountedWcEl = null;
    }
  }
}
