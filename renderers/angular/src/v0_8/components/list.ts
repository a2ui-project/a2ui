/*
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {ChangeDetectionStrategy, Component, input} from '@angular/core';
import type {AnyComponentNode, ListNode, ResolvedList} from '../types';
import {DynamicComponent} from '../rendering/dynamic-component';
import {Renderer} from '../rendering/renderer';

@Component({
  selector: 'a2ui-list',
  imports: [Renderer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.direction]': 'direction()',
  },
  styles: `
    :host {
      display: block;
      flex: var(--weight);
      min-height: 0;
    }

    :host([direction='vertical']) section {
      display: flex;
      flex-direction: column;
      max-height: 100%;
      overflow-y: auto;
    }

    :host([direction='horizontal']) section {
      display: flex;
      max-width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }

    .a2ui-list-item {
      display: flex;
      cursor: pointer;
      box-sizing: border-box;
    }
  `,
  template: `
    <section [class]="theme.components.List" [style]="theme.additionalStyles?.List">
      @for (child of children() ?? component().properties.children; track child?.id ?? child) {
        @if (child) {
          <div class="a2ui-list-item">
            <ng-container a2ui-renderer [surfaceId]="surfaceId()!" [component]="child" />
          </div>
        }
      }
    </section>
  `,
})
export class List extends DynamicComponent<ListNode> {
  readonly alignment = input<ResolvedList['alignment']>('stretch');
  readonly direction = input<ResolvedList['direction']>('vertical');
  readonly children = input<AnyComponentNode[] | null>(null);
}
