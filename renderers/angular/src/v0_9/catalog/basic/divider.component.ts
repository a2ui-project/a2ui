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
import {DividerApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Divider component (v0.9).
 *
 * Renders a horizontal or vertical line to separate content.
 *
 * Supported CSS variables:
 * - `--a2ui-divider-border`: Controls the border of the divider (horizontal and vertical).
 * - `--a2ui-divider-spacing`: Controls the margin around the divider.
 */
@Component({
  selector: 'a2ui-v09-divider',
  standalone: true,
  imports: [],
  host: {
    '[style.display]': '"block"',
    '[style.width]': 'axis() === "horizontal" ? "100%" : "auto"',
  },
  template: `
    <hr
      class="a2ui-divider"
      [class.horizontal]="axis() === 'horizontal'"
      [class.vertical]="axis() === 'vertical'"
    />
  `,
  styles: [
    `
      .a2ui-divider {
        border: 0;
        border-top: var(
          --a2ui-divider-border,
          var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
        );
        margin: var(--a2ui-divider-spacing, var(--a2ui-spacing-m, 16px)) 0;
        width: 100%;
      }
      .a2ui-divider.vertical {
        width: var(--a2ui-border-width, 1px);
        height: 100%;
        margin: 0 var(--a2ui-divider-spacing, var(--a2ui-spacing-m, 16px));
        border-top: 0;
        border-left: var(
          --a2ui-divider-border,
          var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
        );
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DividerComponent extends BasicCatalogComponent<typeof DividerApi> {
  readonly axis = computed(() => this.props()['axis']?.value() ?? 'horizontal');
}
