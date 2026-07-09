/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Component, computed, ChangeDetectionStrategy} from '@angular/core';
import {BasicCatalogComponent} from './basic-catalog-component';
import {DateTimeInputApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI DateTimeInput component (v0.9).
 *
 * Renders date and/or time input fields. Combines them into an ISO string
 * for the bound data model property.
 *
 * Supported CSS variables:
 * - `--a2ui-datetimeinput-background`: Controls the background of inputs.
 * - `--a2ui-datetimeinput-color`: Controls the text color of inputs.
 * - `--a2ui-datetimeinput-border`: Controls the border of inputs.
 * - `--a2ui-datetimeinput-border-radius`: Controls the border radius of inputs.
 * - `--a2ui-datetimeinput-padding`: Controls the padding of inputs.
 * - `--a2ui-datetimeinput-label-font-size`: Controls the font size of the label.
 * - `--a2ui-datetimeinput-label-font-weight`: Controls the font weight of the label.
 */
function normalizeDateTimeValue(value: unknown, type: string): string {
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

  // 1. Try literal extraction of YYYY-MM-DD or YYYY/MM/DD
  const dateRegex = /(\d{4})[-/](\d{2})[-/](\d{2})/;
  const dateMatch = strValue.match(dateRegex);
  if (dateMatch) {
    datePart = `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`;
  }

  // 2. Try literal extraction of HH:mm
  const timeRegex = /(\d{2}):(\d{2})(?::(\d{2}))?/;
  const timeMatch = strValue.match(timeRegex);
  if (timeMatch) {
    timePart = `${timeMatch[1]}:${timeMatch[2]}`;
  }

  // 3. Fallback to Date object parsing if needed
  const needDate = type === 'date' || type === 'datetime-local';
  const needTime = type === 'time' || type === 'datetime-local';

  if ((needDate && !datePart) || (needTime && !timePart)) {
    let parsedDate: Date;
    const num = Number(strValue);
    if (strValue !== '' && !isNaN(num)) {
      parsedDate = new Date(num);
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

@Component({
  selector: 'a2ui-v09-date-time-input',
  standalone: true,
  imports: [],
  template: `
    <div class="a2ui-date-time-container">
      @if (label()) {
        <label class="a2ui-date-time-label">
          {{ label() }}
        </label>
      }
      <div class="a2ui-date-time-inputs">
        @if (enableDate()) {
          <input
            type="date"
            [value]="dateValue()"
            (change)="handleDateChange($event)"
            class="a2ui-date-time-input"
          />
        }
        @if (enableTime()) {
          <input
            type="time"
            [value]="timeValue()"
            (change)="handleTimeChange($event)"
            class="a2ui-date-time-input"
          />
        }
      </div>
    </div>
  `,
  styles: [
    `
      .a2ui-date-time-container {
        display: flex;
        flex-direction: column;
        gap: var(--a2ui-spacing-xs, 4px);
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
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DateTimeInputComponent extends BasicCatalogComponent<typeof DateTimeInputApi> {
  readonly label = computed(() => this.props()['label']?.value());
  readonly enableDate = computed(() => this.props()['enableDate']?.value() ?? true);
  readonly enableTime = computed(() => this.props()['enableTime']?.value() ?? false);

  private readonly rawValue = computed(() => this.props()['value']?.value() || '');

  readonly dateValue = computed(() => {
    return normalizeDateTimeValue(this.rawValue(), 'date');
  });

  readonly timeValue = computed(() => {
    return normalizeDateTimeValue(this.rawValue(), 'time');
  });

  handleDateChange(event: Event) {
    const date = (event.target as HTMLInputElement).value;
    const current = this.rawValue();
    if (this.enableTime()) {
      const time = current.includes('T') ? current.split('T')[1] : '00:00:00';
      this.props()['value']?.onUpdate(`${date}T${time}`);
    } else {
      this.props()['value']?.onUpdate(date);
    }
  }

  handleTimeChange(event: Event) {
    const time = (event.target as HTMLInputElement).value;
    const current = this.rawValue();
    const date = current.includes('T')
      ? current.split('T')[0]
      : current || new Date().toISOString().split('T')[0];
    this.props()['value']?.onUpdate(`${date}T${time}:00`);
  }
}
