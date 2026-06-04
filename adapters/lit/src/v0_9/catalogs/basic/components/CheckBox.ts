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
import {classMap} from 'lit/directives/class-map.js';
import {CheckBoxApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '@a2ui/lit/v0_9';

@customElement('a2ui-checkbox')
export class A2uiCheckBoxElement extends BasicCatalogA2uiLitElement<typeof CheckBoxApi> {
  /**
   * The styles of the checkbox can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-checkbox-size`: Size of the box. Defaults to `1rem`.
   * - `--a2ui-checkbox-border-radius`: Default corner rounding of the box.
   * - `--a2ui-checkbox-gap`: Spacing between the checkbox and its label. Defaults to `8px`.
   * - `--a2ui-checkbox-margin`: Outer margin of the component. Defaults to `--a2ui-spacing-m`.
   * - `--a2ui-checkbox-color-error`: Color for invalid state. Defaults to `red`.
   * - `--a2ui-checkbox-label-font-size`: Font size of the label. Defaults to `--a2ui-label-font-size` then `--a2ui-font-size-s`.
   * - `--a2ui-checkbox-label-font-weight`: Font weight of the label. Defaults to `--a2ui-label-font-weight` then `bold`.
   */
  static styles = css`
    :host {
      display: block;
    }
    .container {
      display: flex;
      flex-direction: column;
      margin: var(--a2ui-checkbox-margin, var(--a2ui-spacing-m));
    }
    label.a2ui-checkbox {
      display: inline-flex;
      align-items: center;
      gap: var(--a2ui-checkbox-gap, var(--a2ui-spacing-s, 0.5rem));
      font-size: var(
        --a2ui-checkbox-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(--a2ui-checkbox-label-font-weight, var(--a2ui-label-font-weight, bold));
      cursor: pointer;
    }
    label.invalid {
      color: var(--a2ui-checkbox-color-error, red);
    }
    input {
      width: var(--a2ui-checkbox-size, 1rem);
      height: var(--a2ui-checkbox-size, 1rem);
      background: var(--a2ui-checkbox-background, inherit);
      border: var(--a2ui-checkbox-border, var(--a2ui-border));
      border-radius: var(--a2ui-checkbox-border-radius, 4px);
    }
    input.invalid {
      outline: 1px solid var(--a2ui-checkbox-color-error, red);
    }
    .error {
      color: var(--a2ui-checkbox-color-error, red);
      font-size: var(--a2ui-font-size-xs, 0.75rem);
      margin-top: 4px;
    }
  `;

  protected createController() {
    return new A2uiController(this, CheckBoxApi);
  }

  render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const isInvalid = props.isValid === false;
    const labelClasses = {'a2ui-checkbox': true, invalid: isInvalid};
    const inputClasses = {invalid: isInvalid};

    return html`
      <div class="container">
        <label class=${classMap(labelClasses)}>
          <input
            type="checkbox"
            class=${classMap(inputClasses)}
            .checked=${props.value || false}
            @change=${(e: Event) => props.setValue?.((e.target as HTMLInputElement).checked)}
          />
          ${props.label}
        </label>
        ${isInvalid && props.validationErrors?.length
          ? html`<div class="error">${props.validationErrors[0]}</div>`
          : nothing}
      </div>
    `;
  }
}

export const A2uiCheckBox = {
  ...CheckBoxApi,
  tagName: 'a2ui-checkbox',
};
