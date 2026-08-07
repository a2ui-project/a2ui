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

import {html, nothing, css} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {TabsApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../a2ui-controller.js';
import {WebComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-tabs')
export class A2uiLitTabs extends BasicCatalogA2uiLitElement<typeof TabsApi> {
  static override styles = css`
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
  `;

  protected createController() {
    return new A2uiController(this, TabsApi);
  }

  @state() accessor activeIndex = 0;

  override willUpdate(changedProperties: any) {
    super.willUpdate(changedProperties);
    const props = this.controller?.props;
    if (props?.tabs && this.activeIndex >= props.tabs.length) {
      this.activeIndex = Math.max(0, props.tabs.length - 1);
    }
  }

  override render() {
    const props = this.controller?.props;
    if (!props || !props.tabs) return nothing;

    return html`
      <div class="a2ui-tabs">
        <div class="a2ui-tab-bar">
          ${props.tabs.map(
            (tab, i) => html`
              <button
                class=${classMap({
                  'a2ui-tab-button': true,
                  active: i === this.activeIndex,
                })}
                @click=${() => (this.activeIndex = i)}
              >
                ${tab.title}
              </button>
            `,
          )}
        </div>
        <div class="a2ui-tab-content">
          ${props.tabs[this.activeIndex]
            ? html`${this.renderNode(props.tabs[this.activeIndex].child)}`
            : nothing}
        </div>
      </div>
    `;
  }
}

export const A2uiTabs: WebComponentImplementation = {
  ...TabsApi,
  tagName: 'a2ui-tabs',
};
