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
import {DateTimeInputApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../a2ui-controller.js';
import {WebComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-datetimeinput')
export class A2uiDateTimeInputElement extends BasicCatalogA2uiLitElement<typeof DateTimeInputApi> {
  static override styles = css`
    .a2ui-date-time-container {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 4px);
      width: 100%;
    }
    input {
      box-sizing: border-box;
      width: 100%;
    }
    .a2ui-date-time-label {
      font-size: var(
        --a2ui-datetimeinput-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s, 14px))
      );
      font-weight: var(--a2ui-datetimeinput-label-font-weight, bold);
      color: var(--a2ui-text-color-text, var(--a2ui-color-on-background, #333));
    }
    .a2ui-date-time-inputs {
      display: flex;
      gap: var(--a2ui-spacing-s, 8px);
      width: 100%;
    }
    .a2ui-date-time-input {
      padding: var(--a2ui-datetimeinput-padding, 8px);
      border-radius: var(--a2ui-datetimeinput-border-radius, 4px);
      border: var(--a2ui-datetimeinput-border, 1px solid var(--a2ui-color-border, #ccc));
      background-color: var(--a2ui-datetimeinput-background, var(--a2ui-color-input, #fff));
      color: var(--a2ui-datetimeinput-color, var(--a2ui-color-on-input, #333));
      font-family: inherit;
      flex: 1;
    }
    .a2ui-date-time-input::-webkit-datetime-edit,
    .a2ui-date-time-input::-webkit-datetime-edit-fields-wrapper {
      color: var(--a2ui-datetimeinput-color, var(--a2ui-color-on-input, #333));
    }
  `;

  protected createController() {
    return new A2uiController(this, DateTimeInputApi);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const enableDate = props.enableDate ?? true;
    const enableTime = props.enableTime ?? false;
    const rawValue = props.value || '';

    const dateValue = rawValue ? (rawValue.includes('T') ? rawValue.split('T')[0] : rawValue) : '';
    const timeValue =
      !rawValue || !rawValue.includes('T') ? '' : rawValue.split('T')[1].substring(0, 5);

    const handleDateChange = (event: Event) => {
      const date = (event.target as HTMLInputElement).value;
      if (enableTime) {
        const time = rawValue.includes('T') ? rawValue.split('T')[1] : '00:00:00';
        props.setValue?.(`${date}T${time}`);
      } else {
        props.setValue?.(date);
      }
    };

    const handleTimeChange = (event: Event) => {
      const time = (event.target as HTMLInputElement).value;
      const date = rawValue.includes('T')
        ? rawValue.split('T')[0]
        : rawValue || new Date().toISOString().split('T')[0];
      props.setValue?.(`${date}T${time}:00`);
    };

    return html`
      <div class="a2ui-date-time-container">
        ${props.label ? html`<label class="a2ui-date-time-label">${props.label}</label>` : nothing}
        <div class="a2ui-date-time-inputs">
          ${enableDate
            ? html`
                <input
                  type="date"
                  .value=${dateValue}
                  @change=${handleDateChange}
                  class="a2ui-date-time-input"
                />
              `
            : nothing}
          ${enableTime
            ? html`
                <input
                  type="time"
                  .value=${timeValue}
                  @change=${handleTimeChange}
                  class="a2ui-date-time-input"
                />
              `
            : nothing}
        </div>
      </div>
    `;
  }
}

export const A2uiDateTimeInput: WebComponentImplementation = {
  ...DateTimeInputApi,
  tagName: 'a2ui-datetimeinput',
};
