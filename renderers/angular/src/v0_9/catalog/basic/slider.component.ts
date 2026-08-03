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
import {SliderApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI Slider component (v0.9).
 *
 * Renders a range input slider with a label and its current value.
 *
 * Supported CSS variables:
 * - `--a2ui-slider-margin`: Controls the margin of the container.
 * - `--a2ui-slider-label-font-size`: Controls the font size of the label.
 * - `--a2ui-slider-label-font-weight`: Controls the font weight of the label.
 * - `--a2ui-slider-thumb-color`: Controls the accent color of the thumb.
 * - `--a2ui-slider-track-color`: Controls the background of the track.
 */
@Component({
  selector: 'a2ui-v09-slider',
  standalone: true,
  imports: [],
  template: `
    <div class="a2ui-slider-container">
      <div class="a2ui-slider-header">
        <label [attr.for]="uniqueId" class="a2ui-slider-label">{{ label() }}</label>
        <span class="a2ui-slider-value">{{ value() }}</span>
      </div>
      <input
        [id]="uniqueId"
        type="range"
        [min]="min()"
        [max]="max()"
        [value]="value()"
        (input)="handleInput($event)"
        class="a2ui-slider"
        [class.invalid]="props()['isValid']?.value() === false"
        [attr.aria-label]="props()['accessibility']?.value()?.label"
        [attr.aria-invalid]="props()['isValid']?.value() === false ? 'true' : 'false'"
        [attr.aria-describedby]="describedBy()"
      />
      @if (props()['validationErrors']?.value()?.length) {
        <div [id]="uniqueId + '-error'">
          @for (message of props()['validationErrors']?.value(); track message) {
            <div class="a2ui-error-message">{{ message }}</div>
          }
        </div>
      }
      @if (props()['accessibility']?.value()?.description) {
        <span
          [id]="uniqueId + '-description'"
          style="position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); border: 0;"
        >
          {{ props()['accessibility']?.value()?.description }}
        </span>
      }
    </div>
  `,
  styles: [
    `
      .a2ui-slider-container {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--a2ui-spacing-xs, 4px);
        margin: var(--a2ui-slider-margin, var(--a2ui-spacing-m, 16px));
      }
      .a2ui-slider-header {
        display: flex;
        justify-content: space-between;
        font-size: var(
          --a2ui-slider-label-font-size,
          var(--a2ui-label-font-size, var(--a2ui-font-size-s, 14px))
        );
        font-weight: var(--a2ui-slider-label-font-weight, bold);
        color: var(--a2ui-text-color-text, var(--a2ui-color-on-background, #333));
      }
      .a2ui-slider {
        width: 100%;
        cursor: pointer;
        accent-color: var(--a2ui-slider-thumb-color, var(--a2ui-color-primary, #007bff));
        background: var(--a2ui-slider-track-color, var(--a2ui-color-secondary, #e9ecef));
      }
      .a2ui-slider.invalid {
        outline: 1px solid var(--a2ui-color-error, red);
      }
      .a2ui-error-message {
        color: var(--a2ui-color-error, red);
        font-size: var(--a2ui-font-size-xs, 12px);
        margin-top: 4px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SliderComponent extends BasicCatalogComponent<typeof SliderApi> {
  readonly label = computed(() => this.props()['label']?.value());
  readonly value = computed(() => this.props()['value']?.value());
  readonly min = computed(() => this.props()['min']?.value() ?? 0);
  readonly max = computed(() => this.props()['max']?.value() ?? 100);

  readonly describedBy = computed(() => {
    const hasError = this.props()['isValid']?.value() === false;
    const hasDesc = !!this.props()['accessibility']?.value()?.description;
    const ids: string[] = [];
    if (hasDesc) {
      ids.push(`${this.uniqueId}-description`);
    }
    if (hasError) {
      ids.push(`${this.uniqueId}-error`);
    }
    return ids.length > 0 ? ids.join(' ') : null;
  });

  handleInput(event: Event) {
    const val = Number((event.target as HTMLInputElement).value);
    this.props()['value']?.onUpdate(val);
  }
}
