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
import {A2uiController} from '../../../a2ui-controller.js';

/**
 * Normalizes an incoming ISO or partial date/time value into a format accepted by HTML5 inputs.
 *
 * HTML5 input elements (like type="date", type="time", and type="datetime-local") strictly reject
 * timezone indicators (like "Z" or "+00:00") and trailing seconds/milliseconds in their .value property.
 * If these are present, the browser will reset the input to an empty string. This function strips
 * those specifiers using string splitting and substring manipulation without shifting timezones.
 */
function normalizeDateTimeValue(value: string | null | undefined, type: string): string {
  if (!value) return '';

  const hasT = value.includes('T');
  const split = value.split('T');

  // If the incoming value is not in ISO format (not hasT), use the incoming value.
  // It might be just a date: '2010-07-11' or a time: '13:37', so we use value as a
  // the fallback to the split.
  const datePart = (hasT ? split[0] : value)?.substring(0, 10) ?? '';
  const timePart = (hasT ? split[1] : value)?.substring(0, 5) ?? '';

  switch (type) {
    case 'date':
      return datePart;
    case 'time':
      return timePart;
    case 'datetime-local':
      return `${datePart}T${timePart}`;
  }
  return '';
}

@customElement('a2ui-datetimeinput')
export class A2uiDateTimeInputElement extends BasicCatalogA2uiLitElement<typeof DateTimeInputApi> {
  /**
   * The styles of the datetime input can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-datetimeinput-label-font-size`: Font size of the label. Defaults to `--a2ui-label-font-size` then `--a2ui-font-size-s`.
   * - `--a2ui-datetimeinput-label-font-weight`: Font weight of the label. Defaults to `--a2ui-label-font-weight` then `bold`.
   */
  static override styles = css`
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

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;
    // If neither date or time are enabled, render nothing.
    if (!(props.enableDate || props.enableTime)) return nothing;

    const inputType =
      props.enableDate && props.enableTime ? 'datetime-local' : props.enableDate ? 'date' : 'time';
    const normalizedValue = normalizeDateTimeValue(props.value, inputType);

    return html`
      ${props.label ? html`<label>${props.label}</label>` : nothing}
      <input
        type=${inputType}
        .value=${normalizedValue}
        @input=${(e: Event) => props.setValue?.((e.target as HTMLInputElement).value)}
      />
    `;
  }
}

export const A2uiDateTimeInput = {
  ...DateTimeInputApi,
  tagName: 'a2ui-datetimeinput',
};
