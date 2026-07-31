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

import {Component, computed, ChangeDetectionStrategy} from '@angular/core';
import {BasicCatalogComponent} from './basic-catalog-component';
import {ImageApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Image component (v0.9).
 *
 * Renders an image with configurable fit and shape variants.
 *
 * Supported CSS variables:
 * - `--a2ui-image-border-radius`: Controls the rounded corners.
 * - `--a2ui-image-icon-size`: Size of the icon variant.
 * - `--a2ui-image-avatar-size`: Size of the avatar variant.
 * - `--a2ui-image-small-feature-size`: Max-width of smallFeature variant.
 * - `--a2ui-image-large-feature-size`: Max-height of largeFeature variant.
 * - `--a2ui-image-header-size`: Height of header variant.
 */
@Component({
  selector: 'a2ui-v09-image',
  standalone: true,
  imports: [],
  template: `
    <img
      [src]="url()"
      [alt]="description()"
      [style.object-fit]="fit()"
      [class]="'a2ui-image ' + variant()"
    />
  `,
  styles: [
    `
      .a2ui-image {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: var(--a2ui-image-border-radius, var(--a2ui-border-radius, 8px));
      }
      .a2ui-image.icon {
        width: var(--a2ui-image-icon-size, 24px);
        height: var(--a2ui-image-icon-size, 24px);
      }
      .a2ui-image.avatar {
        width: var(--a2ui-image-avatar-size, 40px);
        height: var(--a2ui-image-avatar-size, 40px);
        border-radius: 50%;
      }
      .a2ui-image.smallFeature {
        max-width: var(--a2ui-image-small-feature-size, 100px);
      }
      .a2ui-image.largeFeature {
        max-height: var(--a2ui-image-large-feature-size, 400px);
      }
      .a2ui-image.header {
        height: var(--a2ui-image-header-size, 200px);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImageComponent extends BasicCatalogComponent<typeof ImageApi> {
  readonly url = computed(() => this.props()['url']?.value());
  readonly description = computed(() => this.props()['description']?.value() || '');
  readonly fit = computed(() => this.props()['fit']?.value() || 'cover');
  readonly variant = computed(() => this.props()['variant']?.value() || 'default');
}
