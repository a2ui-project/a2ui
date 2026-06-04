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
import {TextFieldApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '@a2ui/lit/v0_9';

@customElement('a2ui-basic-textfield')
export class A2uiBasicTextFieldElement extends BasicCatalogA2uiLitElement<typeof TextFieldApi> {
  /**
   * The styles of the text field can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-textfield-border`: The styling for the text field border. Defaults to `--a2ui-border-width` width and `--a2ui-color-border` color.
   * - `--a2ui-textfield-border-radius`: The border radius of the text field. Defaults to `--a2ui-spacing-m`.
   * - `--a2ui-textfield-padding`: The padding of the text field. Defaults to `--a2ui-spacing-m`.
   * - `--a2ui-textfield-color-border-focus`: The border color on focus. Defaults to `--a2ui-color-primary`.
   * - `--a2ui-textfield-color-error`: The color for both invalid border and error text. Defaults to red.
   * - `--a2ui-textfield-label-font-size`: Font size of the label. Defaults to `--a2ui-label-font-size` then `--a2ui-font-size-s`.
   * - `--a2ui-textfield-label-font-weight`: Font weight of the label. Defaults to `--a2ui-label-font-weight` then `bold`.
   *
   * It also inherits global input variables:
   * - `--a2ui-color-input`: Background color.
   * - `--a2ui-color-on-input`: Text color.
   */
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 0.25rem);
    }
    .a2ui-textfield {
      background-color: var(--a2ui-color-input, #fff);
      color: var(--a2ui-color-on-input, #333);
      border: var(--a2ui-textfield-border, var(--a2ui-border));
      border-radius: var(--a2ui-textfield-border-radius, var(--a2ui-spacing-m));
      padding: var(--a2ui-textfield-padding, var(--a2ui-spacing-m));
      font-family: inherit;
    }
    .a2ui-textfield:focus {
      outline: none;
      border-color: var(--a2ui-textfield-color-border-focus, var(--a2ui-color-primary, #17e));
    }
    .a2ui-textfield.invalid {
      border-color: var(--a2ui-textfield-color-error, red);
    }
    label {
      font-size: var(
        --a2ui-textfield-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(--a2ui-textfield-label-font-weight, var(--a2ui-label-font-weight, bold));
    }
    .error {
      color: var(--a2ui-textfield-color-error, red);
      font-size: var(--a2ui-font-size-xs, 0.75rem);
    }
  `;

  protected createController() {
    return new A2uiController(this, TextFieldApi);
  }

  render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const isInvalid = props.isValid === false;
    const onInput = (e: Event) => props.setValue?.((e.target as HTMLInputElement).value);
    let type = 'text';
    if (props.variant === 'number') type = 'number';
    if (props.variant === 'obscured') type = 'password';

    const classes = {'a2ui-textfield': true, invalid: isInvalid};

    return html`
      ${props.label ? html`<label>${props.label}</label>` : nothing}
      ${props.variant === 'longText'
        ? html`<textarea
            class=${classMap(classes)}
            .value=${props.value || ''}
            @input=${onInput}
          ></textarea>`
        : html`<input
            type=${type}
            class=${classMap(classes)}
            .value=${props.value || ''}
            @input=${onInput}
          />`}
      ${isInvalid && props.validationErrors?.length
        ? html`<div class="error">${props.validationErrors[0]}</div>`
        : nothing}
    `;
  }
}

export const A2uiTextField = {
  ...TextFieldApi,
  tagName: 'a2ui-basic-textfield',
};
