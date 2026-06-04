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
import {DateTimeInputApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '@a2ui/lit/v0_9';

@customElement('a2ui-datetimeinput')
export class A2uiDateTimeInputElement extends BasicCatalogA2uiLitElement<typeof DateTimeInputApi> {
  /**
   * The styles of the datetime input can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-datetimeinput-label-font-size`: Font size of the label. Defaults to `--a2ui-label-font-size` then `--a2ui-font-size-s`.
   * - `--a2ui-datetimeinput-label-font-weight`: Font weight of the label. Defaults to `--a2ui-label-font-weight` then `bold`.
   */
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 0.25rem);
    }
    input {
      background-color: var(--a2ui-datetimeinput-background, var(--a2ui-color-input, #fff));
      color: var(--a2ui-datetimeinput-color, var(--a2ui-color-on-input, #333));
      border: var(--a2ui-datetimeinput-border, var(--a2ui-border));
      border-radius: var(--a2ui-datetimeinput-border-radius, var(--a2ui-border-radius));
      padding: var(--a2ui-datetimeinput-padding, var(--a2ui-spacing-s));
    }
    label {
      font-size: var(
        --a2ui-datetimeinput-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(--a2ui-datetimeinput-label-font-weight, var(--a2ui-label-font-weight, bold));
    }
  `;

  protected createController() {
    return new A2uiController(this, DateTimeInputApi);
  }

  render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const type =
      props.enableDate && props.enableTime ? 'datetime-local' : props.enableDate ? 'date' : 'time';
    return html`
      ${props.label ? html`<label>${props.label}</label>` : nothing}
      <input
        type=${type}
        .value=${props.value || ''}
        @input=${(e: Event) => props.setValue?.((e.target as HTMLInputElement).value)}
      />
    `;
  }
}

export const A2uiDateTimeInput = {
  ...DateTimeInputApi,
  tagName: 'a2ui-datetimeinput',
};
