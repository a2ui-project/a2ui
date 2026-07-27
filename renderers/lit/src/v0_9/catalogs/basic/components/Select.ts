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
import {SelectApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../../../a2ui-controller.js';

@customElement('a2ui-select')
export class A2uiSelectElement extends BasicCatalogA2uiLitElement<typeof SelectApi> {
  static override styles = css`
    :host {
      display: block;
      margin: var(--a2ui-select-margin, var(--a2ui-spacing-m, 8px));
      font-family: inherit;
    }
    .a2ui-select-container {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 4px);
    }
    label {
      font-size: var(--a2ui-font-size-s, 0.875rem);
      color: var(--a2ui-color-on-surface, #333);
      font-weight: 500;
    }
    select {
      padding: var(--a2ui-select-padding, 8px 12px);
      border: var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-border-radius, 6px);
      background-color: var(--a2ui-color-surface, #fff);
      color: var(--a2ui-color-on-surface, #333);
      font-size: var(--a2ui-font-size-m, 1rem);
      cursor: pointer;
    }
    select:focus {
      outline: 2px solid var(--a2ui-color-primary, #17e);
    }
  `;

  protected createController() {
    return new A2uiController(this, SelectApi);
  }

  private onChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const props = this.controller.props;
    if (props) {
      props.setValue?.(target.value);
    }
    // Dispatch custom event for binding update
    this.dispatchEvent(
      new CustomEvent('a2uichange', {
        detail: {value: target.value},
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const options = props.options || [];

    return html`
      <div class="a2ui-select-container">
        ${props.label ? html`<label>${props.label}</label>` : nothing}
        <select .value=${props.value || ''} @change=${this.onChange}>
          ${options.map(
            (opt) => html`<option value=${opt.value} ?selected=${opt.value === props.value}>
              ${opt.label}
            </option>`,
          )}
        </select>
      </div>
    `;
  }
}

export const A2uiSelect = {
  ...SelectApi,
  tagName: 'a2ui-select',
};
