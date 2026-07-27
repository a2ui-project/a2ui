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

import {Directive, computed, HostBinding, inject} from '@angular/core';
import {injectBasicCatalogStyles} from '@a2ui/web_core/v0_9/basic_catalog';
import {A2uiRendererService} from '../../core/a2ui-renderer.service';
import {ComponentApi} from '@a2ui/web_core/v0_9';
import {CatalogComponent} from '../../core/catalog_component';
import {BoundProperty} from '../../core/types';

/**
 * Base class for A2UI basic catalog components in Angular.
 *
 * Automatically injects the basic catalog styles when the component is instantiated.
 * Also binds the primary brand color to the host element.
 */
@Directive()
export abstract class BasicCatalogComponent<
  Api extends ComponentApi,
> extends CatalogComponent<Api> {
  protected rendererService = inject(A2uiRendererService);

  readonly surface = computed(() => {
    return this.rendererService.surfaceGroup.getSurface(this.surfaceId());
  });

  readonly theme = computed(() => {
    return this.surface()?.theme;
  });

  readonly primaryColor = computed(() => {
    return this.theme()?.primaryColor;
  });

  /**
   * Weight is applied as flex css property on the component host HTML element.
   */
  protected readonly weight = computed(() => {
    const props = this.props() as {weight?: BoundProperty<number | undefined>};
    return props['weight']?.value() ?? null;
  });

  constructor() {
    super();
    injectBasicCatalogStyles();
  }

  /**
   * Binds the flex style to the host element based on the weight.
   */
  @HostBinding('style.flex')
  get flexStyle() {
    return this.weight() !== null ? `${this.weight()}` : null;
  }

  @HostBinding('style.--a2ui-color-primary')
  get primaryColorStyle(): string | null {
    return this.primaryColor() || null;
  }
}
