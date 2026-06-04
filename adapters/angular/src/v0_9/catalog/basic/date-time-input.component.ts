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
    const val = this.rawValue();
    if (!val) return '';
    return val.includes('T') ? val.split('T')[0] : val;
  });

  readonly timeValue = computed(() => {
    const val = this.rawValue();
    if (!val || !val.includes('T')) return '';
    return val.split('T')[1].substring(0, 5);
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
