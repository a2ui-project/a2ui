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
  computed,
  inject,
  input,
} from '@angular/core';
import {SurfaceModel} from '@a2ui/web_core/v0_9';
import {A2uiRendererService} from './a2ui-renderer.service';
import {ComponentHostComponent} from './component-host.component';
import {CatalogComponent} from '../catalog/types';

/**
 * High-level component for rendering an entire A2UI surface.
 *
 * This component sets up a {@link ComponentHostComponent} for the 'root'
 * component of a surface, seamlessly supporting both native Angular components
 * and universal Web Components.
 */
@Component({
  selector: 'a2ui-v09-surface',
  standalone: true,
  imports: [ComponentHostComponent],
  host: {
    '[style.display]': '"contents"',
  },
  template: `
    @if (effectiveSurfaceId()) {
      <a2ui-v09-component-host
        [componentKey]="{id: 'root', basePath: dataContextPath()}"
        [surfaceId]="effectiveSurfaceId()!"
      >
      </a2ui-v09-component-host>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SurfaceComponent implements OnDestroy {
  /** Directly provided SurfaceModel instance. */
  surface = input<SurfaceModel<CatalogComponent>>();

  /** The unique identifier of the surface to look up from A2uiRendererService. */
  surfaceId = input<string>();

  /**
   * The path within the surface's data model that represents the current state.
   * Defaults to the root ('/').
   */
  dataContextPath = input<string>('/');

  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly rendererService = inject(A2uiRendererService, {optional: true});

  protected readonly effectiveSurfaceId = computed(() => {
    const s = this.surface();
    if (s) {
      if (
        this.rendererService?.surfaceGroup &&
        !this.rendererService.surfaceGroup.getSurface(s.id)
      ) {
        this.rendererService.surfaceGroup.addSurface(s);
      }
      return s.id;
    }
    return this.surfaceId();
  });

  ngOnDestroy(): void {
    this.elementRef.nativeElement.innerHTML = '';
  }
}
