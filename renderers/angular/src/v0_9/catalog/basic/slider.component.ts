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
        <span class="a2ui-slider-label">{{ label() }}</span>
        <span class="a2ui-slider-value">{{ value() }}</span>
      </div>
      <input
        type="range"
        [min]="min()"
        [max]="max()"
        [step]="step()"
        [value]="value()"
        (input)="handleInput($event)"
        class="a2ui-slider"
      />
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
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SliderComponent extends BasicCatalogComponent<typeof SliderApi> {
  readonly label = computed(() => this.props()['label']?.value());
  readonly value = computed(() => this.props()['value']?.value());
  readonly min = computed(() => this.props()['min']?.value() ?? 0);
  readonly max = computed(() => this.props()['max']?.value() ?? 100);
  readonly step = computed(() => this.props()['step']?.value() ?? 1);

  handleInput(event: Event) {
    const val = Number((event.target as HTMLInputElement).value);
    this.props()['value']?.onUpdate(val);
  }
}
