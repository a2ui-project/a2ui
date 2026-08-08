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
  Component,
  ElementRef,
  OnDestroy,
  effect,
  inject,
  input,
} from '@angular/core';
import {
  ComponentContext,
  SurfaceModel,
  WebComponentImplementation,
  Subscription,
} from '@a2ui/web_core/v0_9';
import {Context} from '@a2ui/web_core/v0_9/basic_catalog';
import {ContextProvider} from '@lit/context';
import {A2uiRendererService} from './a2ui-renderer.service';
import {MarkdownRenderer, type MarkdownRendererOptions} from './markdown';

/**
 * Renders an A2UI v0.9 surface using Universal Web Components.
 *
 * Can receive a SurfaceModel directly via the `surface` input or look it up
 * by `surfaceId` from the injected `A2uiRendererService`.
 * Automatically mounts the root custom element and re-renders on changes to the
 * component subtree.
 */
@Component({
  selector: 'a2ui-v09-surface',
  standalone: true,
  template: '',
  host: {
    '[style.display]': '"contents"',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SurfaceComponent implements OnDestroy {
  /** Directly provided SurfaceModel instance. */
  surface = input<SurfaceModel<WebComponentImplementation>>();

  /** The unique identifier of the surface to look up from A2uiRendererService. */
  surfaceId = input<string>();

  /**
   * The path within the surface's data model that represents the current state.
   * Defaults to the root ('/').
   */
  dataContextPath = input<string>('/');

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly rendererService = inject(A2uiRendererService, {optional: true});
  private currentRootEl: HTMLElement | null = null;
  private unsubscribe?: () => void;
  private surfaceCreatedSub?: Subscription;

  constructor() {
    const md = inject(MarkdownRenderer, {optional: true});
    if (md) {
      new ContextProvider(this.elementRef.nativeElement, {
        context: Context.markdown,
        initialValue: (val: string, opts?: MarkdownRendererOptions) => md.render(val, opts),
      });
    }

    effect(() => {
      this.surface();
      this.surfaceId();
      this.dataContextPath();
      this.mountRoot();
    });
  }

  private getEffectiveSurface(): SurfaceModel<WebComponentImplementation> | undefined {
    const directSurface = this.surface();
    if (directSurface) return directSurface;

    const id = this.surfaceId();
    if (id && this.rendererService) {
      return this.rendererService.surfaceGroup?.getSurface(id) as
        | SurfaceModel<WebComponentImplementation>
        | undefined;
    }
    return undefined;
  }

  private mountRoot(): void {
    this.cleanup();

    const surface = this.getEffectiveSurface();
    if (!surface) {
      const id = this.surfaceId();
      if (id && this.rendererService?.surfaceGroup) {
        this.surfaceCreatedSub = this.rendererService.surfaceGroup.onSurfaceCreated.subscribe(s => {
          if (s.id === id) {
            this.surfaceCreatedSub?.unsubscribe();
            this.surfaceCreatedSub = undefined;
            this.mountRoot();
          }
        });
      }
      this.elementRef.nativeElement.innerHTML = '';
      this.currentRootEl = null;
      return;
    }

    const basePath = this.dataContextPath() || '/';

    const renderRoot = () => {
      const rootModel = surface.componentsModel.get('root');
      if (!rootModel) {
        this.elementRef.nativeElement.innerHTML = '';
        this.currentRootEl = null;
        return;
      }

      const rootImpl = surface.catalog.components.get(rootModel.type) as
        | WebComponentImplementation
        | undefined;
      if (!rootImpl) {
        console.error(`Root component "${rootModel.type}" not found in catalog.`);
        return;
      }

      interface ContextConsumerElement extends HTMLElement {
        context: ComponentContext;
      }

      if (
        this.currentRootEl &&
        this.currentRootEl.tagName.toLowerCase() === rootImpl.tagName.toLowerCase()
      ) {
        (this.currentRootEl as ContextConsumerElement).context = new ComponentContext(
          surface,
          'root',
          basePath,
        );
        return;
      }

      this.elementRef.nativeElement.innerHTML = '';
      const rootEl = document.createElement(rootImpl.tagName) as ContextConsumerElement;
      rootEl.context = new ComponentContext(surface, 'root', basePath);
      this.currentRootEl = rootEl;
      this.elementRef.nativeElement.appendChild(this.currentRootEl);
    };

    renderRoot();

    const subCreated = surface.componentsModel.onCreated.subscribe(comp => {
      if (comp.id === 'root') renderRoot();
    });
    const subDeleted = surface.componentsModel.onDeleted.subscribe(id => {
      if (id === 'root') renderRoot();
    });

    this.unsubscribe = () => {
      subCreated.unsubscribe();
      subDeleted.unsubscribe();
    };
  }

  private cleanup(): void {
    this.surfaceCreatedSub?.unsubscribe();
    this.surfaceCreatedSub = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  ngOnDestroy(): void {
    this.cleanup();
    this.elementRef.nativeElement.innerHTML = '';
    this.currentRootEl = null;
  }
}
