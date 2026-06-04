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
import {CheckBoxApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI CheckBox component (v0.9).
 *
 * Renders a checkbox with a label. Updates the bound data model property
 * when the checked state changes.
 *
 * Supported CSS variables:
 * - `--a2ui-checkbox-margin`: Controls the margin.
 * - `--a2ui-checkbox-gap`: Controls the gap between checkbox and label.
 * - `--a2ui-checkbox-label-font-size`: Controls the font size of the label.
 * - `--a2ui-checkbox-label-font-weight`: Controls the font weight of the label.
 * - `--a2ui-checkbox-size`: Controls the width and height of the checkbox.
 * - `--a2ui-checkbox-background`: Controls the background of the checkbox.
 * - `--a2ui-checkbox-border`: Controls the border of the checkbox.
 * - `--a2ui-checkbox-border-radius`: Controls the border radius of the checkbox.
 * - `--a2ui-checkbox-color-error`: Controls the color for error states.
 */
@Component({
  selector: 'a2ui-v09-check-box',
  standalone: true,
  imports: [],
  template: `
    <label class="a2ui-check-box-label">
      <input
        type="checkbox"
        [checked]="value()"
        (change)="handleChange($event)"
        class="a2ui-check-box-input"
      />
      <span class="a2ui-check-box-text">{{ label() }}</span>
    </label>
  `,
  styles: [
    `
      .a2ui-check-box-label {
        display: flex;
        align-items: center;
        gap: var(--a2ui-checkbox-gap, var(--a2ui-spacing-s, 0.5rem));
        cursor: pointer;
        padding: 4px 0;
        margin: var(--a2ui-checkbox-margin, var(--a2ui-spacing-m, 16px));
        color: var(--a2ui-text-color-text, var(--a2ui-color-on-background, #333));
      }
      .a2ui-check-box-input {
        width: var(--a2ui-checkbox-size, 1rem);
        height: var(--a2ui-checkbox-size, 1rem);
        cursor: pointer;
        background: var(--a2ui-checkbox-background, inherit);
        border: var(--a2ui-checkbox-border, var(--a2ui-border-width, 1px) solid #ccc);
        border-radius: var(--a2ui-checkbox-border-radius, 4px);
        accent-color: var(--a2ui-color-primary);
      }
      .a2ui-check-box-text {
        font-size: var(
          --a2ui-checkbox-label-font-size,
          var(--a2ui-label-font-size, var(--a2ui-font-size-s, 16px))
        );
        font-weight: var(--a2ui-checkbox-label-font-weight, bold);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckBoxComponent extends BasicCatalogComponent<typeof CheckBoxApi> {
  readonly value = computed(() => this.props()['value']?.value() === true);
  readonly label = computed(() => this.props()['label']?.value());

  handleChange(event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.props()['value']?.onUpdate(checked);
  }
}
