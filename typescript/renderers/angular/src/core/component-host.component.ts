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
  untracked,
  NgZone,
} from '@angular/core';
import {NgComponentOutlet} from '@angular/common';
import {
  ComponentContext,
  type ComponentNode,
  ResolvedBinding,
  SurfaceModel,
  Subscription,
  getValue,
  isComponentNode,
} from '@a2ui/web_core/v0_9';
import {
  isWebComponentImplementation,
  registerUniversalElement,
  type WebComponentImplementation,
} from '@a2ui/web_core/v0_9/universal';
import {A2uiRendererService} from './a2ui-renderer.service';
import {Child, ComponentBinder} from './component-binder.service';
import {SurfaceNodeResolver} from './surface-node-resolver.service';
import {BoundProperty} from './types';

import type {AngularCatalog, AngularComponentImplementation} from '../catalog/types';
import {CatalogComponentInstance} from './catalog_component_instance';

interface UniversalComponentHostElement extends HTMLElement {
  node?: ComponentNode;
  context: ComponentContext;
  injector?: Injector;
}

/** The key of the component to render: an ID string or a {@link Child} reference. */
export type ComponentKey = string | Child;

type AngularNode = ComponentNode<AngularComponentImplementation>;

/**
 * Finds the node for `componentId` at `dataPath` in the tree below `value`.
 *
 * Reads child props with `getValue`, so a reactive context that calls this
 * re-runs when any visited node's props change.
 */
function findNodeInTree(
  value: unknown,
  componentId: string,
  dataPath: string,
): AngularNode | undefined {
  if (isComponentNode(value)) {
    if (value.componentId === componentId && value.dataPath === dataPath && !value.isPlaceholder) {
      return value as AngularNode;
    }
    return findNodeInList(Object.values(getValue(value.props)), componentId, dataPath);
  }
  if (value instanceof ResolvedBinding) {
    return findNodeInTree(value.value, componentId, dataPath);
  }
  if (Array.isArray(value)) {
    return findNodeInList(value, componentId, dataPath);
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return findNodeInList(Object.values(value), componentId, dataPath);
  }
  return undefined;
}

function findNodeInList(
  items: unknown[],
  componentId: string,
  dataPath: string,
): AngularNode | undefined {
  for (const item of items) {
    const found = findNodeInTree(item, componentId, dataPath);
    if (found) return found;
  }
  return undefined;
}

/**
 * Dynamically renders an A2UI component as defined in the current surface model.
 *
 * This component acts as a bridge between the A2UI surface model and UI components.
 * It can render both native Angular `@Component` implementations (via `NgComponentOutlet`)
 * and universal W3C Web Components (by instantiating and appending the custom element tag).
 *
 * The component to render is the resolved `ComponentNode` for `componentKey`: a
 * {@link Child} reference produced by a parent's bound props carries its node
 * directly, while a bare id (or a child reference without a node) is resolved from
 * the surface's `NodeResolver` root tree and tracked until it appears.
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
  /** The key of the component to render, either an ID string or a child reference. Defaults to 'root'. */
  componentKey = input<ComponentKey>('root');

  /** The unique identifier of the surface this component belongs to. */
  surfaceId = input.required<string>();

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly rendererService = inject(A2uiRendererService);
  private readonly binder = inject(ComponentBinder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly ngZone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly injector = inject(Injector);
  private readonly sharedResolver = inject(SurfaceNodeResolver, {optional: true});
  private ownResolver?: SurfaceNodeResolver;

  protected readonly componentType = signal<Type<CatalogComponentInstance> | null>(null);
  protected readonly props = signal<Record<string, BoundProperty>>({});
  /** Bumped when a surface that was missing is created, so the setup effect re-runs. */
  private readonly surfaceRetry = signal(0);
  private currentBoundProps?: Record<string, BoundProperty>;
  private resolvedNode?: AngularNode;
  private activeSurface?: SurfaceModel<AngularComponentImplementation>;
  private mountedWcEl: UniversalComponentHostElement | null = null;

  protected resolvedComponentId: string = '';
  protected resolvedDataContextPath: string = '/';

  private propsSub?: Subscription;
  private surfaceSub?: Subscription;

  constructor() {
    effect(() => {
      const key = this.componentKey();
      const surfaceId = this.surfaceId();
      this.surfaceRetry();
      if (!key || !surfaceId) return;

      const surface = untracked(() => this.rendererService.surfaceGroup?.getSurface(surfaceId));
      if (!surface) {
        untracked(() => this.waitForSurface(surfaceId));
        return;
      }
      const {id, basePath} = parseKey(key);
      // Tracked: re-runs when the resolved node for this key changes.
      const node = this.resolveNode(surface, key, id, basePath);
      untracked(() => this.mount(surface, node, id, basePath));
    });

    this.destroyRef.onDestroy(() => {
      this.resetState();
      this.ownResolver?.ngOnDestroy();
      this.ownResolver = undefined;
    });
  }

  private waitForSurface(surfaceId: string): void {
    this.resetState();
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
        this.ngZone.run(() => this.surfaceRetry.update(n => n + 1));
      }
    });
    if (sub) {
      this.surfaceSub = sub;
      if (unsubscribed) {
        this.surfaceSub.unsubscribe();
        this.surfaceSub = undefined;
      }
    }
  }

  private resolverFor(surface: SurfaceModel<AngularComponentImplementation>) {
    if (this.sharedResolver) {
      return this.sharedResolver.resolverFor(surface);
    }
    this.ownResolver ??= new SurfaceNodeResolver();
    return this.ownResolver.resolverFor(surface);
  }

  /**
   * Resolves the node to render. A child reference that already carries its node is
   * used as is; otherwise the node is looked up from the surface root (tracked).
   */
  private resolveNode(
    surface: SurfaceModel<AngularComponentImplementation>,
    key: ComponentKey,
    id: string,
    basePath: string,
  ): AngularNode | undefined {
    if (typeof key === 'object' && key.node) {
      return key.node as AngularNode;
    }
    const root = getValue(this.resolverFor(surface).rootNode);
    if (!root) return undefined;
    if (root.componentId === id && root.dataPath === basePath) {
      return root;
    }
    return findNodeInTree(root, id, basePath) ?? (root.componentId === id ? root : undefined);
  }

  private mount(
    surface: SurfaceModel<AngularComponentImplementation>,
    node: AngularNode | undefined,
    id: string,
    basePath: string,
  ): void {
    if (node && node === this.resolvedNode && surface === this.activeSurface) {
      return;
    }
    this.resetState();
    this.activeSurface = surface;
    this.resolvedComponentId = id;
    this.resolvedDataContextPath = basePath;

    if (!node || node.isPlaceholder || !node.impl || !node.context) {
      this.reportUnresolved(surface, node, id);
      return;
    }
    this.resolvedNode = node;
    this.resolvedDataContextPath = node.dataPath;

    // Entries from `createComponentImplementation` carry both an Angular component and a Custom
    // Element; the flag picks which one to mount. Web Component-only entries render only with the
    // flag on (their placeholder `component` reports the misconfiguration otherwise).
    if (this.rendererService.useUniversalComponents && isWebComponentImplementation(node.impl)) {
      this.setupWebComponent(node.impl, node);
    } else {
      this.setupAngularComponent(node.impl.component, node);
    }
  }

  private reportUnresolved(
    surface: SurfaceModel<AngularComponentImplementation>,
    node: AngularNode | undefined,
    id: string,
  ): void {
    if (node?.state === 'unknown-type') {
      const catalog = surface.componentsModel.get(id)?.catalog as AngularCatalog | undefined;
      console.error(`Component type "${node.type}" not found in catalog "${catalog?.id}"`);
      return;
    }
    if (node?.state === 'cyclic') {
      console.error(`Component ${id} references one of its own ancestors in surface ${surface.id}`);
      return;
    }
    console.warn(`Component ${id} not found in surface ${surface.id}. Waiting for it...`);
  }

  private setupAngularComponent(
    componentClass: Type<CatalogComponentInstance>,
    node: AngularNode,
  ): void {
    this.componentType.set(componentClass);
    this.updateProps();

    this.propsSub = node.context!.componentModel.onUpdated.subscribe(() => {
      this.ngZone.run(() => this.updateProps());
    });
  }

  /** Re-binds the props of the mounted Angular component and schedules change detection. */
  private updateProps(): void {
    if (!this.resolvedNode) return;
    if (this.currentBoundProps) {
      this.binder.unbind(this.currentBoundProps);
    }
    const nextProps = this.binder.bindNode(this.resolvedNode);
    this.currentBoundProps = nextProps;
    this.props.set(nextProps);
    this.cdr.markForCheck();
  }

  private setupWebComponent(implementation: WebComponentImplementation, node: AngularNode): void {
    this.componentType.set(null);
    this.props.set({});

    registerUniversalElement(implementation);
    const tagName = implementation.tagName;

    const el = document.createElement(tagName) as UniversalComponentHostElement;
    el.injector = this.injector;
    el.node = node;
    el.context = node.context!;
    this.mountedWcEl = el;
    this.elementRef.nativeElement.appendChild(el);

    this.propsSub = node.context!.componentModel.onUpdated.subscribe(() => {
      this.ngZone.run(() => {
        if (this.mountedWcEl) {
          this.mountedWcEl.node = node;
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
    this.surfaceSub?.unsubscribe();
    this.surfaceSub = undefined;

    this.resolvedNode = undefined;
    this.activeSurface = undefined;

    this.componentType.set(null);
    if (this.currentBoundProps) {
      this.binder.unbind(this.currentBoundProps);
      this.currentBoundProps = undefined;
    }
    this.props.set({});
    this.resolvedDataContextPath = '/';

    if (this.mountedWcEl) {
      this.mountedWcEl.remove();
      this.mountedWcEl = null;
    }
  }
}

function parseKey(key: ComponentKey): {id: string; basePath: string} {
  if (typeof key === 'object' && key !== null && 'id' in key) {
    return {id: key.id, basePath: key.basePath || '/'};
  }
  return {id: key, basePath: '/'};
}
