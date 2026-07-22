/*
 * Copyright 2026 Google LLC
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
import {customElement} from 'lit/decorators.js';
import {SwitchApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../../../a2ui-controller.js';

@customElement('a2ui-switch')
export class A2uiSwitchElement extends BasicCatalogA2uiLitElement<typeof SwitchApi> {
  static override styles = css`
    :host {
      display: inline-block;
      margin: var(--a2ui-switch-margin, var(--a2ui-spacing-m, 8px));
      font-family: inherit;
    }
    .a2ui-switch-wrapper {
      display: inline-flex;
      align-items: center;
      gap: var(--a2ui-spacing-s, 8px);
      cursor: pointer;
    }
    .switch {
      position: relative;
      display: inline-block;
      width: 44px;
      height: 24px;
    }
    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: var(--a2ui-switch-off-bg, #ccc);
      transition: 0.3s;
      border-radius: 24px;
    }
    .slider:before {
      position: absolute;
      content: '';
      height: 18px;
      width: 18px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: 0.3s;
      border-radius: 50%;
    }
    input:checked + .slider {
      background-color: var(--a2ui-color-primary, #17e);
    }
    input:checked + .slider:before {
      transform: translateX(20px);
    }
    .label-text {
      font-size: var(--a2ui-font-size-m, 1rem);
      color: var(--a2ui-color-on-surface, #333);
    }
  `;

  protected createController() {
    return new A2uiController(this, SwitchApi);
  }

  private onChange(e: Event) {
    const target = e.target as HTMLInputElement;
    this.dispatchEvent(
      new CustomEvent('a2uichange', {
        detail: {value: target.checked},
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    return html`
      <label class="a2ui-switch-wrapper">
        <span class="switch">
          <input
            type="checkbox"
            .checked=${Boolean(props.value)}
            @change=${this.onChange}
          />
          <span class="slider"></span>
        </span>
        ${props.label ? html`<span class="label-text">${props.label}</span>` : nothing}
      </label>
    `;
  }
}

export const A2uiSwitch = {
  ...SwitchApi,
  tagName: 'a2ui-switch',
};
