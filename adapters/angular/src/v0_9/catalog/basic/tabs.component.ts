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

import {Component, computed, ChangeDetectionStrategy, signal} from '@angular/core';
import {ComponentHostComponent} from '../../core/component-host.component';
import {BasicCatalogComponent} from './basic-catalog-component';
import {TabsApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Tabs component (v0.9).
 *
 * Renders a set of tabs where each tab has a label and associated content.
 * Manages the active tab state internally.
 *
 * Supported CSS variables:
 * - `--a2ui-tabs-border`: Controls the border of the tab bar.
 * - `--a2ui-tabs-header-background`: Controls the background of tab buttons.
 * - `--a2ui-tabs-header-color`: Controls the text color of tab buttons.
 * - `--a2ui-tabs-header-background-active`: Controls the background of the active tab button.
 * - `--a2ui-tabs-header-color-active`: Controls the text color of the active tab button.
 * - `--a2ui-tabs-content-padding`: Controls the padding of the tab content.
 */
@Component({
  selector: 'a2ui-v09-tabs',
  standalone: true,
  imports: [ComponentHostComponent],
  template: `
    <div class="a2ui-tabs">
      <div class="a2ui-tab-bar">
        @for (tab of tabs(); track tab; let i = $index) {
          <button
            class="a2ui-tab-button"
            [class.active]="activeTabIndex() === i"
            (click)="setActiveTab(i)"
          >
            {{ tab.title }}
          </button>
        }
      </div>
      @if (normalizedActiveTabChild()) {
        <div class="a2ui-tab-content">
          <a2ui-v09-component-host
            [componentKey]="normalizedActiveTabChild()!"
            [surfaceId]="surfaceId()"
          >
          </a2ui-v09-component-host>
        </div>
      }
    </div>
  `,
  styles: [
    `
      .a2ui-tabs {
        display: flex;
        flex-direction: column;
        width: 100%;
      }
      .a2ui-tab-bar {
        display: flex;
        border-bottom: var(--a2ui-tabs-border, 2px solid var(--a2ui-color-border, #eee));
        gap: var(--a2ui-spacing-m, 16px);
      }
      .a2ui-tab-button {
        padding: var(--a2ui-spacing-s, 8px) var(--a2ui-spacing-m, 16px);
        border: none;
        background: var(--a2ui-tabs-header-background, transparent);
        cursor: pointer;
        font-weight: 500;
        color: var(--a2ui-tabs-header-color, var(--a2ui-text-caption-color, #666));
        border-bottom: 2px solid transparent;
        margin-bottom: -2px;
      }
      .a2ui-tab-button.active {
        background: var(--a2ui-tabs-header-background-active, transparent);
        color: var(--a2ui-tabs-header-color-active, var(--a2ui-color-primary, #007bff));
        border-bottom: 2px solid var(--a2ui-color-primary, #007bff);
      }
      .a2ui-tab-content {
        padding: var(--a2ui-tabs-content-padding, var(--a2ui-spacing-m, 16px) 0);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TabsComponent extends BasicCatalogComponent<typeof TabsApi> {
  activeTabIndex = signal(0);

  readonly tabs = computed(() => this.props()['tabs']?.value() || []);
  readonly activeTab = computed(() => this.tabs()[this.activeTabIndex()]);

  protected readonly normalizedActiveTabChild = computed(() => {
    const child = this.activeTab()?.child;
    if (!child) return null;
    if (typeof child === 'object' && child !== null && 'id' in child) {
      return child as {id: string; basePath: string};
    }
    return {id: child as string, basePath: this.dataContextPath()};
  });

  setActiveTab(index: number) {
    this.activeTabIndex.set(index);
  }
}
