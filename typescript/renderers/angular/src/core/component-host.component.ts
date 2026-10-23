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
import { NgComponentOutlet } from '@angular/common';
import {
  ComponentContext,
  ComponentModel,
  NodeResolver,
  peekValue,
  SurfaceModel,
  Subscription,
  type ComponentNode,
} from '@a2ui/web_core/v0_9';
import {
  isWebComponentImplementation,
  registerUniversalElement,
  type WebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import { A2uiRendererService } from './a2ui-renderer.service';
import { ComponentBinder } from './component-binder.service';
import { BoundProperty } from './types';

import type { AngularCatalog, AngularComponentImplementation } from '../catalog/types';
import { toWebComponent } from '../catalog/to_web_component';
import { CatalogComponentInstance } from './catalog_component_instance';

interface UniversalComponentHostElement extends HTMLElement {
  context: ComponentContext;
  node?: ComponentNode;
  injector?: Injector;
  controller?: { dispose?: () => void };
}

function ensureCatalogWebComponents(catalog: AngularCatalog | undefined): void {
  if (!catalog?.components) return;
  for (const entry of catalog.components.values()) {
    if (
      entry &&
      typeof entry === 'object' &&
      typeof entry.component === 'function' &&
      !isWebComponentImplementation(entry) &&
      entry.name &&
      entry.schema
    ) {
      Object.assign(entry, toWebComponent(entry));
    }
    if (isWebComponentImplementation(entry)) {
      registerUniversalElement(entry);
    }
  }
}

function prepareSurfaceCatalogsForUniversal(
  surface: SurfaceModel<AngularComponentImplementation>,
  componentCatalog?: AngularCatalog,
): void {
  ensureCatalogWebComponents(surface.defaultCatalog as AngularCatalog | undefined);
  ensureCatalogWebComponents(componentCatalog);
  if (surface.availableCatalogs) {
    for (const catalog of surface.availableCatalogs.values()) {
      ensureCatalogWebComponents(catalog as AngularCatalog);
    }
  }
  for (const comp of surface.componentsModel?.values ?? []) {
    ensureCatalogWebComponents(comp.catalog as AngularCatalog | undefined);
  }
}

function disposeElementControllers(root: HTMLElement): void {
  const elements = [root, ...Array.from(root.querySelectorAll('*'))];
  for (const el of elements) {
    const hostEl = el as UniversalComponentHostElement;
    if (typeof hostEl.controller?.dispose === 'function') {
      hostEl.controller.dispose();
    }
  }
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
  componentKey = input<string | { id: string; basePath: string }>('root');

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
  private deleteSub?: Subscription;
  private nodeResolver?: NodeResolver<AngularComponentImplementation>;

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

  private waitForSurface(key: string | { id: string; basePath: string }, surfaceId: string): void {
    console.warn(`Surface ${surfaceId} not found. Waiting for it...`);
    this.surfaceSub?.unsubscribe();
    let unsubscribed = false;
    const sub = this.rendererService.surfaceGroup?.onSurfaceCreated?.subscribe((s) => {
      if (s.id !== surfaceId) return;
      unsubscribed = true;
      this.surfaceSub?.unsubscribe();
      this.surfaceSub = undefined;
      this.ngZone.run(() => {
        this.setupComponent(key, surfaceId);
      });
    });
    if (!sub) return;
    this.surfaceSub = sub;
    if (unsubscribed) {
      this.surfaceSub.unsubscribe();
      this.surfaceSub = undefined;
    }
  }

  private parseComponentKey(key: string | { id: string; basePath: string }): {
    id: string;
    basePath: string;
  } {
    if (typeof key === 'object' && key !== null && 'id' in key) {
      return { id: key.id, basePath: key.basePath || '/' };
    }
    return { id: key, basePath: '/' };
  }

  private setupComponent(key: string | { id: string; basePath: string }, surfaceId: string) {
    this.resetState();

    const surface = this.rendererService.surfaceGroup?.getSurface(surfaceId);

    if (!surface) {
      this.waitForSurface(key, surfaceId);
      return;
    }

    const { id, basePath } = this.parseComponentKey(key);
    this.resolvedComponentId = id;

    const componentModel = surface.componentsModel.get(id);

    if (!componentModel) {
      console.warn(`Component ${id} not found in surface ${surfaceId}. Waiting for it...`);

      const sub = surface.componentsModel.onCreated.subscribe((comp) => {
        if (comp.id === id) {
          this.ngZone.run(() => this.initializeComponent(surface, comp, id, basePath, surfaceId));
          sub.unsubscribe();
        }
      });
      this.createSub = sub;
      return;
    }

    this.initializeComponent(surface, componentModel, id, basePath, surfaceId);
  }

  private initializeComponent(
    surface: SurfaceModel<AngularComponentImplementation>,
    componentModel: ComponentModel,
    id: string,
    basePath: string,
    surfaceId: string,
  ): void {
    // Type changes remove the old ComponentModel and add a new one under the same id.
    // If this listener runs first, `get(id)` is still undefined and `setupComponent` waits on
    // `onCreated`. If it runs later in `emit`'s async loop (after the new model is added),
    // `get(id) !== componentModel` stops the new listener registered by `setupComponent` from
    // firing in the same `emit` pass.
    // Subscribe before the catalog lookup so an unknown type can still be replaced later.
    this.deleteSub = surface.componentsModel.onDeleted.subscribe((deletedId) => {
      if (deletedId === id && surface.componentsModel.get(id) !== componentModel) {
        this.ngZone.run(() => this.setupComponent({ id, basePath }, surfaceId));
      }
    });

    // Resolve component from the component's owning catalog.
    const catalog = componentModel.catalog as AngularCatalog;
    if (this.rendererService.useUniversalComponents) {
      prepareSurfaceCatalogsForUniversal(surface, catalog);
    }
    if (
      surface instanceof SurfaceModel &&
      id === (surface.rootId ?? 'root') &&
      basePath === '/' &&
      !this.nodeResolver
    ) {
      this.nodeResolver = new NodeResolver(surface, surface.defaultCatalog);
    }
    const componentImpl = catalog.components.get(componentModel.type);

    if (!componentImpl) {
      console.error(`Component type "${componentModel.type}" not found in catalog "${catalog.id}"`);
      if (!this.nodeResolver) {
        surface.dispatchError?.({
          code: 'UNKNOWN_COMPONENT_TYPE',
          message: `Component '${id}' has type '${componentModel.type}', which is not in catalog '${catalog.id}'.`,
        });
      }
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
    const resolvedNode = this.nodeResolver ? peekValue(this.nodeResolver.rootNode) : undefined;

    if (this.mountedWcEl && this.mountedWcEl.tagName.toLowerCase() === tagName.toLowerCase()) {
      this.mountedWcEl.injector = this.injector;
      this.mountedWcEl.context = resolvedNode?.context ?? this.context!;
      this.mountedWcEl.node = resolvedNode;
    } else {
      if (this.mountedWcEl) {
        disposeElementControllers(this.mountedWcEl);
        this.mountedWcEl.remove();
        this.mountedWcEl = null;
      }
      const el = document.createElement(tagName) as UniversalComponentHostElement;
      el.injector = this.injector;
      el.context = resolvedNode?.context ?? this.context!;
      el.node = resolvedNode;
      this.mountedWcEl = el;
      this.elementRef.nativeElement.appendChild(el);
    }

    this.propsSub = componentModel.onUpdated.subscribe(() => {
      this.ngZone.run(() => {
        if (this.mountedWcEl) {
          const nextNode = this.nodeResolver ? peekValue(this.nodeResolver.rootNode) : undefined;
          this.mountedWcEl.context =
            nextNode?.context ?? new ComponentContext(surface, id, basePath);
          this.mountedWcEl.node = nextNode;
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
    this.deleteSub?.unsubscribe();
    this.deleteSub = undefined;
    this.nodeResolver?.dispose();
    this.nodeResolver = undefined;

    this.componentType.set(null);
    this.props.set({});
    this.resolvedDataContextPath = '/';

    if (this.mountedWcEl) {
      disposeElementControllers(this.mountedWcEl);
      this.mountedWcEl.remove();
      this.mountedWcEl = null;
    }
  }
}
