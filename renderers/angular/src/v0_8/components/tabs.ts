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

import {ChangeDetectionStrategy, Component, input, signal} from '@angular/core';
import {DynamicComponent} from '../rendering/dynamic-component';
import {Renderer} from '../rendering/renderer';
import type {ResolvedTabs, TabsNode} from '../types';

@Component({
  selector: 'a2ui-tabs',
  imports: [Renderer],
  template: `
    <div [class]="theme.components.Tabs.container" [style]="theme.additionalStyles?.Tabs">
      <div [class]="theme.components.Tabs.controls.all">
        @for (item of tabItems(); track item.child; let i = $index) {
          <button
            [class]="selectedIndex() === i ? theme.components.Tabs.controls.selected : {}"
            (click)="selectTab(i)"
          >
            {{ resolvePrimitive(item.title) }}
          </button>
        }
      </div>
      <div class="a2ui-tabs-content">
        @if (tabItems()[selectedIndex()]; as selectedTab) {
          <ng-container a2ui-renderer [surfaceId]="surfaceId()!" [component]="selectedTab.child" />
        }
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .a2ui-tabs-content {
      flex: 1;
      min-height: 0;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Tabs extends DynamicComponent<TabsNode> {
  readonly tabItems = input.required<ResolvedTabs['tabItems']>();
  protected readonly selectedIndex = signal(0);

  protected selectTab(index: number) {
    this.selectedIndex.set(index);
  }
}
