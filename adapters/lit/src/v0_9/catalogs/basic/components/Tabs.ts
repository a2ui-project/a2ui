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
import {TabsApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '@a2ui/lit/v0_9';

@customElement('a2ui-tabs')
export class A2uiLitTabs extends BasicCatalogA2uiLitElement<typeof TabsApi> {
  /**
   * The styles of the tabs can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-tabs-header-background`: Default transparent.
   * - `--a2ui-tabs-header-background-active`: Default `--a2ui-color-secondary`.
   * - `--a2ui-tabs-header-color`: Default `--a2ui-color-on-surface`.
   * - `--a2ui-tabs-header-color-active`: Default `--a2ui-color-on-secondary`.
   * - `--a2ui-tabs-border`: Default `--a2ui-border-width` solid `--a2ui-color-border`.
   * - `--a2ui-tabs-content-padding`: Default `0 var(--a2ui-spacing-m, 0.5rem)`.
   */
  static styles = css`
    :host {
      display: block;
    }
    .a2ui-tabs-headers {
      display: flex;
      gap: var(--a2ui-spacing-xs, 0.25rem);
      border-bottom: var(
        --a2ui-tabs-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      margin-bottom: var(--a2ui-spacing-m, 0.5rem);
    }
    .a2ui-tabs-header {
      padding: var(--a2ui-spacing-m, 0.5rem) var(--a2ui-spacing-l, 1rem);
      background: var(--a2ui-tabs-header-background, transparent);
      color: var(--a2ui-tabs-header-color, var(--a2ui-color-on-surface));
      border: none;
      border-radius: var(--a2ui-border-radius, 0.25rem) var(--a2ui-border-radius, 0.25rem) 0 0;
      cursor: pointer;
      font-family: inherit;
    }
    .a2ui-tabs-header.active {
      background: var(--a2ui-tabs-header-background-active, var(--a2ui-color-secondary, #eee));
      color: var(--a2ui-tabs-header-color-active, var(--a2ui-color-on-secondary, #333));
    }
    .a2ui-tabs-content {
      padding: var(--a2ui-tabs-content-padding, 0 var(--a2ui-spacing-m, 0.5rem));
    }
  `;

  protected createController() {
    return new A2uiController(this, TabsApi);
  }

  @state() accessor activeIndex = 0;

  render() {
    const props = this.controller.props;
    if (!props || !props.tabs) return nothing;
    return html`
      <div class="a2ui-tabs-headers">
        ${props.tabs.map(
          (tab: any, i: number) => html`
            <button
              class=${classMap({
                'a2ui-tabs-header': true,
                active: i === this.activeIndex,
              })}
              @click=${() => (this.activeIndex = i)}
            >
              ${tab.title}
            </button>
          `,
        )}
      </div>
      <div class="a2ui-tabs-content">
        ${props.tabs[this.activeIndex]
          ? html`${this.renderNode(props.tabs[this.activeIndex].child)}`
          : nothing}
      </div>
    `;
  }
}

export const A2uiTabs = {
  ...TabsApi,
  tagName: 'a2ui-tabs',
};
