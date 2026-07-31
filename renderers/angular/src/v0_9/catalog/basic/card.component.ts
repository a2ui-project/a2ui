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
import {ComponentHostComponent} from '../../core/component-host.component';
import {BasicCatalogComponent} from './basic-catalog-component';
import {CardApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Card component (v0.9).
 *
 * Renders a container with a shadow and rounded corners for grouping related content.
 *
 * Supported CSS variables:
 * - `--a2ui-card-padding`: Controls the padding.
 * - `--a2ui-card-border-radius`: Controls the border radius.
 * - `--a2ui-card-box-shadow`: Controls the box shadow.
 * - `--a2ui-card-background`: Controls the background color.
 * - `--a2ui-card-border`: Controls the border.
 * - `--a2ui-card-margin`: Controls the margin.
 */
@Component({
  selector: 'a2ui-v09-card',
  standalone: true,
  imports: [ComponentHostComponent],
  template: `
    <div class="a2ui-card">
      @if (child()) {
        <a2ui-v09-component-host [componentKey]="child()!" [surfaceId]="surfaceId()">
        </a2ui-v09-component-host>
      }
    </div>
  `,
  styles: [
    `
      .a2ui-card {
        padding: var(--a2ui-card-padding, var(--a2ui-spacing-m, 16px));
        border-radius: var(--a2ui-card-border-radius, var(--a2ui-border-radius, 8px));
        box-shadow: var(--a2ui-card-box-shadow, 0 2px 4px rgba(0, 0, 0, 0.1));
        background: var(--a2ui-card-background, var(--a2ui-color-surface, #fff));
        border: var(
          --a2ui-card-border,
          var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
        );
        margin: var(--a2ui-card-margin, var(--a2ui-spacing-m, 16px));
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CardComponent extends BasicCatalogComponent<typeof CardApi> {
  readonly child = computed(() => this.props()['child']?.value());
}
