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
import {BasicCatalogA2uiLitElement} from './basic-catalog-a2ui-lit-element.js';
import type {DateTimeInputSupportedApis} from './supported_apis.js';

/**
 * Returns the current date formatted as YYYY-MM-DD in the user's local timezone.
 */
export function getLocalIsoDate(): string {
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
 * If these are present, the browser will reset the input to an empty string. This function parses
 * and extracts the date and time components without shifting timezones.
 */
export function normalizeDateTimeValue(value: unknown, type: string): string {
  if (value === null || value === undefined || value === '') return '';

  let strValue = '';
  if (value instanceof Date) {
    strValue = value.toISOString();
  } else {
    strValue = String(value).trim();
  }

  if (!strValue) return '';

  let datePart = '';
  let timePart = '';

  // 1. Try literal extraction of YYYY-MM-DD or YYYY/MM/DD (supporting 1 or 2 digit month/day)
  const dateRegex = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
  const dateMatch = strValue.match(dateRegex);
  if (dateMatch) {
    datePart = `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`;
  }

  // 2. Try literal extraction of HH:mm (supporting 1 or 2 digit hour)
  const timeRegex = /(?:^|\s|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/;
  const timeMatch = strValue.match(timeRegex);
  if (timeMatch) {
    timePart = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
  }

  // 3. Fallback to Date object parsing if needed
  const needDate = type === 'date' || type === 'datetime-local';
  const needTime = type === 'time' || type === 'datetime-local';

  if ((needDate && !datePart) || (needTime && !timePart)) {
    const isTimestamp = strValue !== '' && !isNaN(Number(strValue));
    // Only fallback to Date parsing if we don't have a literal datePart,
    // or if the input is a numeric timestamp.
    if (!datePart || isTimestamp) {
      let parsedDate: Date;
      if (isTimestamp) {
        parsedDate = new Date(Number(strValue));
      } else {
        parsedDate = new Date(strValue);
      }

      if (!isNaN(parsedDate.getTime())) {
        if (!datePart) {
          const y = parsedDate.getFullYear();
          const m = String(parsedDate.getMonth() + 1).padStart(2, '0');
          const d = String(parsedDate.getDate()).padStart(2, '0');
          datePart = `${y}-${m}-${d}`;
        }
        if (!timePart) {
          const h = String(parsedDate.getHours()).padStart(2, '0');
          const min = String(parsedDate.getMinutes()).padStart(2, '0');
          timePart = `${h}:${min}`;
        }
      }
    }
  }

  // If timePart is empty but we need it and datePart is present, default to '00:00'
  if (type === 'datetime-local' && datePart && !timePart) {
    timePart = '00:00';
  }

  switch (type) {
    case 'date':
      return datePart;
    case 'time':
      return timePart;
    case 'datetime-local':
      return datePart && timePart ? `${datePart}T${timePart}` : '';
  }
  return '';
}

export class A2uiDateTimeInputElement extends BasicCatalogA2uiLitElement<DateTimeInputSupportedApis> {
  /** @nocollapse */
  static readonly tagName = 'a2ui-datetimeinput';
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
   *
   * @nocollapse
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
    .a2ui-error-message {
      color: var(--a2ui-datetimeinput-color-error, red);
      font-size: var(--a2ui-font-size-xs, 0.75rem);
    }
  `;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const enableTime = props.enableTime ?? false;
    const enableDate = props.enableDate ?? !enableTime;
    const rawValue =
      typeof props.value === 'string' ? props.value : props.value ? String(props.value) : '';
    const rawMin = typeof props.min === 'string' ? props.min : props.min ? String(props.min) : '';
    const rawMax = typeof props.max === 'string' ? props.max : props.max ? String(props.max) : '';

    const dateValue = normalizeDateTimeValue(rawValue, 'date');
    const timeValue = normalizeDateTimeValue(rawValue, 'time');
    const minDate = normalizeDateTimeValue(rawMin, 'date');
    const maxDate = normalizeDateTimeValue(rawMax, 'date');
    const minTime = normalizeDateTimeValue(rawMin, 'time');
    const maxTime = normalizeDateTimeValue(rawMax, 'time');

    const handleDateChange = (event: Event) => {
      const date = (event.target as HTMLInputElement).value;
      if (enableTime) {
        let time = normalizeDateTimeValue(rawValue, 'time');
        if (!time) {
          time = '00:00:00';
        } else if (time.length === 5) {
          time = `${time}:00`;
        }
        props.setValue?.(`${date}T${time}`);
      } else {
        props.setValue?.(date);
      }
    };

    const handleTimeChange = (event: Event) => {
      const time = (event.target as HTMLInputElement).value;
      if (enableDate) {
        const date = normalizeDateTimeValue(rawValue, 'date') || getLocalIsoDate();
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
                  min=${minDate || nothing}
                  max=${maxDate || nothing}
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
                  min=${minTime || nothing}
                  max=${maxTime || nothing}
                  .value=${timeValue}
                  @change=${handleTimeChange}
                  class="a2ui-date-time-input"
                />
              `
            : nothing}
        </div>
        ${this.renderValidationErrors(props)}
      </div>
    `;
  }
}
