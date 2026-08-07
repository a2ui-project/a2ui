/*
 * Copyright 2024 Google LLC
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
 * Returns the current date formatted as YYYY-MM-DD in the user's local timezone.
 */
function getLocalIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

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
  if (hasT) {
    const [datePart, timePart] = value.split('T');
    switch (type) {
      case 'date':
        return datePart?.substring(0, 10) ?? '';
      case 'time':
        return timePart?.substring(0, 5) ?? '';
      case 'datetime-local':
        return `${datePart?.substring(0, 10) ?? ''}T${timePart?.substring(0, 5) ?? ''}`;
    }
  }

  // Not ISO with 'T': value might be just date ('YYYY-MM-DD') or just time ('HH:MM')
  if (type === 'date') {
    return value.includes('-') ? value.substring(0, 10) : '';
  }
  if (type === 'time') {
    return value.includes(':') ? value.substring(0, 5) : '';
  }
  return '';
}

@customElement('a2ui-datetimeinput')
export class A2uiDateTimeInputElement extends BasicCatalogA2uiLitElement<typeof DateTimeInputApi> {
  /**
   * The styles of the datetime input can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-datetimeinput-width`: Width of the component. Defaults to `100%`.
   * - `--a2ui-datetimeinput-background`: Controls the background of inputs.
   * - `--a2ui-datetimeinput-color`: Controls the text color of inputs.
   * - `--a2ui-datetimeinput-border`: Controls the border of inputs.
   * - `--a2ui-datetimeinput-border-radius`: Controls the border radius of inputs.
   * - `--a2ui-datetimeinput-padding`: Controls the padding of inputs.
   * - `--a2ui-datetimeinput-label-font-size`: Font size of the label. Defaults to `--a2ui-label-font-size` then `--a2ui-font-size-s`.
   * - `--a2ui-datetimeinput-label-font-weight`: Font weight of the label. Defaults to `--a2ui-label-font-weight` then `bold`.
   */
  static override styles = css`
    .a2ui-date-time-container {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-xs, 4px);
      width: var(--a2ui-datetimeinput-width, 100%);
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
    const props = this.controller.props;
    if (!props) return nothing;

    const enableDate = props.enableDate ?? true;
    const enableTime = props.enableTime ?? false;
    const rawValue =
      typeof props.value === 'string' ? props.value : props.value ? String(props.value) : '';

    const dateValue = normalizeDateTimeValue(rawValue, 'date');
    const timeValue = normalizeDateTimeValue(rawValue, 'time');

    const handleDateChange = (event: Event) => {
      const date = (event.target as HTMLInputElement).value;
      if (enableTime) {
        const time = rawValue.includes('T')
          ? rawValue.split('T')[1]
          : rawValue.includes(':')
            ? rawValue
            : '00:00:00';
        props.setValue?.(`${date}T${time}`);
      } else {
        props.setValue?.(date);
      }
    };

    const handleTimeChange = (event: Event) => {
      const time = (event.target as HTMLInputElement).value;
      if (enableDate) {
        const date = rawValue.includes('T')
          ? rawValue.split('T')[0]
          : rawValue.includes('-')
            ? rawValue
            : getLocalIsoDate();
        props.setValue?.(`${date}T${time}:00`);
      } else {
        props.setValue?.(time);
      }
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

export const A2uiDateTimeInput = {
  ...DateTimeInputApi,
  tagName: 'a2ui-datetimeinput',
};
