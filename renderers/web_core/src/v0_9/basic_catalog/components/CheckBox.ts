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
import {customElement} from 'lit/decorators.js';
import {CheckBoxApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../a2ui-controller.js';
import {WebComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-checkbox')
export class A2uiCheckBoxElement extends BasicCatalogA2uiLitElement<typeof CheckBoxApi> {
  static override styles = css`
    .a2ui-check-box-label {
      display: flex;
      align-items: center;
      gap: var(--a2ui-checkbox-gap, var(--a2ui-spacing-s, 0.5rem));
      cursor: pointer;
      padding: 4px 0;
      margin: var(--a2ui-checkbox-margin, var(--a2ui-spacing-m, 16px));
      color: var(--a2ui-text-color-text, var(--a2ui-color-on-background, #333));
    }
    .a2ui-check-box-input {
      width: var(--a2ui-checkbox-size, 1rem);
      height: var(--a2ui-checkbox-size, 1rem);
      cursor: pointer;
      background: var(--a2ui-checkbox-background, inherit);
      border: var(--a2ui-checkbox-border, var(--a2ui-border-width, 1px) solid #ccc);
      border-radius: var(--a2ui-checkbox-border-radius, 4px);
      accent-color: var(--a2ui-color-primary);
    }
    .a2ui-check-box-text {
      font-size: var(
        --a2ui-checkbox-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s, 16px))
      );
      font-weight: var(--a2ui-checkbox-label-font-weight, bold);
    }
  `;

  protected createController() {
    return new A2uiController(this, CheckBoxApi);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    return html`
      <label class="a2ui-check-box-label">
        <input
          type="checkbox"
          .checked=${props.value === true}
          @change=${(e: Event) => props.setValue?.((e.target as HTMLInputElement).checked)}
          class="a2ui-check-box-input"
        />
        <span class="a2ui-check-box-text">${props.label}</span>
      </label>
      ${props.validationErrors?.length
        ? props.validationErrors.map(
            (msg: string) => html`<div class="a2ui-error-message">${msg}</div>`,
          )
        : nothing}
    `;
  }
}

export const A2uiCheckBox: WebComponentImplementation = {
  ...CheckBoxApi,
  tagName: 'a2ui-checkbox',
};
