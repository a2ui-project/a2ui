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
import {Child} from '../../core/component-binder.service';
import {ListApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI List component (v0.9).
 *
 * Renders a list of child components with support for ordered, unordered,
 * and unstyled layouts in both vertical and horizontal directions.
 *
 * Supported CSS variables:
 * - `--a2ui-list-gap`: Controls the gap between items.
 * - `--a2ui-list-padding`: Controls the padding (applied to padding-inline-start).
 */
@Component({
  selector: 'a2ui-v09-list',
  standalone: true,
  imports: [ComponentHostComponent],
  template: `
    @switch (listTag()) {
      @case ('ol') {
        <ol [class]="'a2ui-list ' + direction()" [style.list-style-type]="styleType()">
          @for (child of children(); track trackBy($index, child)) {
            <li>
              <a2ui-v09-component-host [componentKey]="child" [surfaceId]="surfaceId()">
              </a2ui-v09-component-host>
            </li>
          }
        </ol>
      }
      @case ('ul') {
        <ul [class]="'a2ui-list ' + direction()" [style.list-style-type]="styleType()">
          @for (child of children(); track trackBy($index, child)) {
            <li>
              <a2ui-v09-component-host [componentKey]="child" [surfaceId]="surfaceId()">
              </a2ui-v09-component-host>
            </li>
          }
        </ul>
      }
      @default {
        <div [class]="'a2ui-list ' + direction()" style="list-style-type: none;">
          @for (child of children(); track trackBy($index, child)) {
            <div class="a2ui-list-item-none">
              <a2ui-v09-component-host [componentKey]="child" [surfaceId]="surfaceId()">
              </a2ui-v09-component-host>
            </div>
          }
        </div>
      }
    }
  `,
  styles: [
    `
      .a2ui-list {
        display: flex;
        padding-inline-start: var(--a2ui-list-padding, var(--a2ui-spacing-l, 24px));
        margin: 0;
      }
      .a2ui-list.vertical {
        flex-direction: column;
        gap: var(--a2ui-list-gap, var(--a2ui-spacing-s, 8px));
      }
      .a2ui-list.horizontal {
        flex-direction: row;
        gap: var(--a2ui-list-gap, var(--a2ui-spacing-m, 16px));
        list-style-position: inside;
      }
      .a2ui-list-item-none {
        display: block;
      }
      .horizontal .a2ui-list-item-none {
        display: inline-block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListComponent extends BasicCatalogComponent<typeof ListApi> {
  readonly listStyle = computed(() => this.props()['listStyle']?.value());
  readonly direction = computed(() => this.props()['direction']?.value() || 'vertical');
  readonly children = computed(() => this.props()['children'].value());

  readonly listTag = computed(() => {
    const style = this.listStyle();
    if (style === 'ordered') return 'ol';
    if (style === 'unordered') return 'ul';
    return 'div';
  });

  readonly styleType = computed(() => {
    const style = this.listStyle();
    if (style === 'none') return 'none';
    return '';
  });

  /**
   * Track-by function to ensure stable change detection for list items.
   * Uses the full resolved path (`basePath/id`) to uniquely identify items.
   */
  readonly trackBy = (index: number, item: Child) => `${item.basePath}/${item.id}`;
}
