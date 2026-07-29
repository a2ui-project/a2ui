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
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Type,
  computed,
  inject,
  input,
  effect,
  signal,
  NgZone,
} from '@angular/core';
import { NgComponentOutlet, NgTemplateOutlet } from '@angular/common';
import {
  A2uiFallbackInfo,
  ComponentContext,
  ComponentModel,
  SurfaceModel,
  Subscription,
} from '@a2ui/web_core/v0_9';
import { A2uiRendererService } from './a2ui-renderer.service';
import { AngularCatalog } from '../catalog/types';
import { ComponentBinder } from './component-binder.service';
import { A2UI_FALLBACK_TEMPLATES, A2uiFallbackTemplateContext } from './fallback-templates';
import { BoundProperty } from './types';

/**
 * Dynamically renders an A2UI component as defined in the current surface model.
 *
 * This component acts as a bridge between the A2UI surface model and Angular components.
 * It resolves the appropriate component from the catalog based on the component's type,
 * and uses {@link ComponentBinder} to create reactive property bindings.
 *
 * Usually, you'll use the higher-level {@link SurfaceComponent} which automatically
 * sets up a host for the 'root' component.
 */
@Component({
  selector: 'a2ui-v09-component-host',
  imports: [NgComponentOutlet, NgTemplateOutlet],
  host: {
    style: 'display: contents;',
  },
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
    } @else if (fallbackTemplate(); as tpl) {
      <ng-container *ngTemplateOutlet="tpl; context: fallbackContext()!"></ng-container>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComponentHostComponent {
  /** The key of the component to render, either an ID string or an object with ID and basePath. Defaults to 'root'. */
  componentKey = input<string | { id: string; basePath: string }>('root');

  /** The unique identifier of the surface this component belongs to. */
  surfaceId = input.required<string>();

  private readonly rendererService = inject(A2uiRendererService);
  private readonly binder = inject(ComponentBinder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private readonly fallbackTemplates = inject(A2UI_FALLBACK_TEMPLATES, { optional: true });
  private readonly parentHost = inject(ComponentHostComponent, { optional: true, skipSelf: true });

  protected readonly componentType = signal<Type<unknown> | null>(null);
  protected readonly props = signal<Record<string, BoundProperty>>({});
  protected readonly fallbackInfo = signal<A2uiFallbackInfo | null>(null);
  private context?: ComponentContext;

  protected resolvedComponentId: string = '';
  protected resolvedDataContextPath: string = '/';

  /** The resolved A2UI type of this host's component; read by child hosts as their parent hint. */
  resolvedModelType?: string;

  /** Unknown types already dispatched to the agent — once per type per host instance. */
  private readonly dispatchedErrorTypes = new Set<string>();

  protected readonly fallbackTemplate = computed(() => {
    const info = this.fallbackInfo();
    if (!info || !this.fallbackTemplates) return null;
    if (info.state === 'loading') return this.fallbackTemplates.loadingTemplate() ?? null;
    if (info.state === 'unknownComponent') {
      return this.fallbackTemplates.unknownComponentTemplate() ?? null;
    }
    return null;
  });

  protected readonly fallbackContext = computed<A2uiFallbackTemplateContext | null>(() => {
    const info = this.fallbackInfo();
    if (!info) return null;
    return {
      $implicit: info,
      componentId: info.componentId,
      ...(info.state === 'unknownComponent' ? { componentType: info.componentType } : {}),
    };
  });

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
      this.propsSub?.unsubscribe();
      this.createSub?.unsubscribe();
      this.surfaceSub?.unsubscribe();
    });
  }

  private setupComponent(key: string | { id: string; basePath: string }, surfaceId: string) {
    this.resetState();

    const surface = this.rendererService.surfaceGroup?.getSurface(surfaceId);

    if (!surface) {
      console.warn(`Surface ${surfaceId} not found. Waiting for it...`);
      this.surfaceSub?.unsubscribe();
      let unsubscribed = false;
      const sub = this.rendererService.surfaceGroup?.onSurfaceCreated?.subscribe((s) => {
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
      this.fallbackInfo.set({
        state: 'loading',
        componentId: id,
        ...this.parentTypeHint(),
      });

      const sub = surface.componentsModel.onCreated.subscribe((comp) => {
        if (comp.id === id) {
          // onCreated originates from transport callbacks that can run outside
          // the Angular zone; clearing the loading fallback rides this path, so
          // wrap it like the sibling surfaceSub/propsSub handlers to stay
          // reactive under provideZoneChangeDetection({ignoreChangesOutsideZone}).
          this.ngZone.run(() => {
            this.initializeComponent(surface, comp, id, basePath);
          });
          sub.unsubscribe();
        }
      });
      this.createSub = sub;
      return;
    }

    this.initializeComponent(surface, componentModel, id, basePath);
  }

  private initializeComponent(
    surface: SurfaceModel,
    componentModel: ComponentModel,
    id: string,
    basePath: string,
  ): void {
    // Resolve component from the surface's catalog
    const catalog = surface.catalog as AngularCatalog;
    const api = catalog.components.get(componentModel.type);

    if (!api) {
      console.error(`Component type "${componentModel.type}" not found in catalog "${catalog.id}"`);
      if (!this.dispatchedErrorTypes.has(componentModel.type)) {
        this.dispatchedErrorTypes.add(componentModel.type);
        // Deferred: initializeComponent can run inside change detection
        // (constructor effect); onError listeners must not run synchronously
        // from it.
        queueMicrotask(() => {
          void surface.dispatchError({
            code: 'COMPONENT_NOT_FOUND',
            message: `Component implementation not found for type: ${componentModel.type}`,
            componentId: id,
            componentType: componentModel.type,
          });
        });
      }
      this.fallbackInfo.set({
        state: 'unknownComponent',
        componentId: id,
        componentType: componentModel.type,
        ...this.parentTypeHint(),
      });
      return;
    }
    this.resolvedModelType = componentModel.type;
    this.componentType.set(api.component);
    this.fallbackInfo.set(null);

    // Create context
    this.context = new ComponentContext(surface, id, basePath);
    this.props.set(this.binder.bind(this.context));
    this.resolvedDataContextPath = this.context.dataContext.path;

    // Subscribes to updates to the component model properties, to get the
    // component to react when a new prop is added after creation.
    this.propsSub = componentModel.onUpdated.subscribe(() => {
      this.ngZone.run(() => {
        this.props.set(this.binder.bind(this.context!));
      });
    });
  }

  /**
   * The parent host's resolved type, but only when the parent belongs to the
   * same surface. The `skipSelf` injection walks past a nested
   * `SurfaceComponent` boundary, so without this guard an embedded surface's
   * root host would report the OUTER surface's type — violating the shared
   * contract (parentComponentType absent at a surface root) and diverging
   * from React, where the hint is threaded explicitly per surface.
   */
  private parentTypeHint(): { parentComponentType?: string } {
    const parent = this.parentHost;
    const type =
      parent && parent.surfaceId() === this.surfaceId() ? parent.resolvedModelType : undefined;
    return type !== undefined ? { parentComponentType: type } : {};
  }

  /**
   * Resets the component host state, unsubscribing from active subscriptions
   * and clearing component properties to avoid rendering stale data while
   * a new component is being loaded.
   */
  private resetState(): void {
    this.propsSub?.unsubscribe();
    this.createSub?.unsubscribe();
    this.surfaceSub?.unsubscribe();

    this.componentType.set(null);
    this.props.set({});
    this.fallbackInfo.set(null);
    this.resolvedDataContextPath = '/';
    this.resolvedModelType = undefined;
  }
}
