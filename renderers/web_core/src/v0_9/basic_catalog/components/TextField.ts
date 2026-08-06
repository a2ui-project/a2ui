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
import {TextFieldApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../a2ui-controller.js';
import {WebComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-basic-textfield')
export class A2uiBasicTextFieldElement extends BasicCatalogA2uiLitElement<typeof TextFieldApi> {
  static override styles = css`
    .a2ui-text-field-container {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 4px);
      margin: var(--a2ui-spacing-xs, 4px);
    }
    label {
      font-size: var(
        --a2ui-textfield-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s, 14px))
      );
      font-weight: var(--a2ui-textfield-label-font-weight, bold);
      color: var(--a2ui-text-color-text, var(--a2ui-color-on-background, #333));
    }
    input,
    textarea {
      padding: var(--a2ui-textfield-padding, 8px);
      border: var(--a2ui-textfield-border, 1px solid var(--a2ui-color-border, #ccc));
      border-radius: var(--a2ui-textfield-border-radius, 4px);
      background-color: var(--a2ui-color-input, #fff);
      color: var(--a2ui-color-on-input, #333);
      font-family: inherit;
    }
    input:focus,
    textarea:focus {
      border-color: var(--a2ui-textfield-color-border-focus, var(--a2ui-color-primary, #17e));
      outline: none;
    }
    input.invalid,
    textarea.invalid {
      border-color: var(--a2ui-textfield-color-error, var(--a2ui-color-error, red));
    }
    .a2ui-error-message,
    .error {
      color: var(--a2ui-textfield-color-error, var(--a2ui-color-error, red));
      font-size: var(--a2ui-font-size-xs, 12px);
    }
  `;

  protected createController() {
    return new A2uiController(this, TextFieldApi);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const isInvalid = props.isValid === false;
    const onInput = (e: Event) => props.setValue?.((e.target as HTMLInputElement).value);
    let type = 'text';
    if (props.variant === 'number') type = 'number';
    if (props.variant === 'obscured') type = 'password';

    const classes = {'a2ui-textfield': true, invalid: isInvalid};

    return html`
      <div class="a2ui-text-field-container">
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
          ? props.validationErrors.map(
              (msg: string) => html`<div class="error a2ui-error-message">${msg}</div>`,
            )
          : nothing}
      </div>
    `;
  }
}

export const A2uiTextField: WebComponentImplementation = {
  ...TextFieldApi,
  tagName: 'a2ui-basic-textfield',
};
