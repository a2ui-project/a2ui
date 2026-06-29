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
import {Child} from '../../core/component-binder.service';
import {BasicCatalogComponent} from './basic-catalog-component';
import {JUSTIFY_MAP, ALIGN_MAP} from './utils';
import {ColumnApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Column component (v0.9).
 *
 * Arranges child components in a vertical flex layout. Supports both static
 * lists of children and repeating templates bound to a data collection.
 *
 * Supported CSS variables:
 * - `--a2ui-column-gap`: Controls the gap between items in the column. Defaults to `--a2ui-spacing-m` (16px).
 */
@Component({
  selector: 'a2ui-v09-column',
  standalone: true,
  imports: [ComponentHostComponent],
  host: {
    '[style.display]': '"flex"',
    '[style.flex-direction]': '"column"',
    '[style.width]': '"100%"',
    '[style.gap]': '"var(--a2ui-column-gap, var(--a2ui-spacing-m, 16px))"',
    '[style.justify-content]': 'justify()',
    '[style.align-items]': 'align()',
  },
  template: `
    @for (child of children(); track trackChild($index, child)) {
      <a2ui-v09-component-host [componentKey]="child" [surfaceId]="surfaceId()">
      </a2ui-v09-component-host>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColumnComponent extends BasicCatalogComponent<typeof ColumnApi> {
  protected readonly justify = computed(() => {
    const val = this.props()['justify']?.value();
    return val ? JUSTIFY_MAP[val] || val : undefined;
  });
  protected readonly align = computed(() => {
    const val = this.props()['align']?.value();
    return val ? ALIGN_MAP[val] || val : undefined;
  });

  protected readonly children = computed(() => this.props()['children'].value() || []);

  protected trackChild(_index: number, child: Child) {
    return `${child.basePath}/${child.id}`;
  }
}
