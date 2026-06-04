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
import {ChoicePickerApi} from '@a2ui/web_core/v0_9/basic_catalog';

/**
 * Angular implementation of the A2UI ChoicePicker component (v0.9).
 *
 * Renders a set of options as either radio buttons/checkboxes or chips.
 * Supports both single and multiple selection.
 *
 * Supported CSS variables:
 * - `--a2ui-choicepicker-gap`: Controls spacing between options/chips.
 * - `--a2ui-choicepicker-padding`: Controls padding of the container.
 * - `--a2ui-choicepicker-checkbox-size`: Controls size of checkboxes/radios.
 * - `--a2ui-choicepicker-chip-padding`: Controls padding of chips.
 * - `--a2ui-choicepicker-chip-border-radius`: Controls border radius of chips.
 * - `--a2ui-choicepicker-chip-border`: Controls border of chips.
 * - `--a2ui-choicepicker-chip-background`: Controls background of chips.
 * - `--a2ui-choicepicker-chip-background-selected`: Controls background of selected chips.
 */
@Component({
  selector: 'a2ui-v09-choice-picker',
  standalone: true,
  imports: [],
  template: `
    <div class="a2ui-choice-picker">
      <!-- Chips Variant -->
      @if (displayStyle() === 'chips') {
        <div class="a2ui-chips-group">
          @for (option of options(); track option.value) {
            <button
              class="a2ui-chip"
              [class.active]="isSelected(option.value)"
              (click)="toggleActive(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      } @else {
        <!-- Checkbox/Radio Variant -->
        <div class="a2ui-options-group">
          @for (option of options(); track option.value) {
            <label class="a2ui-option-label">
              <input
                [type]="isMultiple() ? 'checkbox' : 'radio'"
                [name]="componentId()"
                [value]="option.value"
                [checked]="isSelected(option.value)"
                (change)="onCheckChange(option.value, $event)"
                class="a2ui-option-input"
              />
              <span class="a2ui-option-text">{{ option.label }}</span>
            </label>
          }
        </div>
      }
    </div>
  `,
  styles: [
    `
      .a2ui-choice-picker {
        width: 100%;
        padding: var(--a2ui-choicepicker-padding, 0);
      }
      .a2ui-options-group {
        display: flex;
        flex-direction: column;
        gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
      }
      .a2ui-option-label {
        display: flex;
        align-items: center;
        gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
        cursor: pointer;
        color: var(--a2ui-text-color-text, var(--a2ui-color-on-background, #333));
      }
      .a2ui-option-input {
        width: var(--a2ui-choicepicker-checkbox-size, 1rem);
        height: var(--a2ui-choicepicker-checkbox-size, 1rem);
      }
      .a2ui-chips-group {
        display: flex;
        flex-wrap: wrap;
        gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
      }
      .a2ui-chip {
        padding: var(
          --a2ui-choicepicker-chip-padding,
          var(--a2ui-spacing-s, 0.5rem) var(--a2ui-spacing-m, 1rem)
        );
        border-radius: var(--a2ui-choicepicker-chip-border-radius, 100px);
        border: var(--a2ui-choicepicker-chip-border, 1px solid var(--a2ui-color-border, #ccc));
        background: var(--a2ui-choicepicker-chip-background, var(--a2ui-color-surface, #fff));
        cursor: pointer;
        transition: all 0.2s;
      }
      .a2ui-chip.active {
        background-color: var(
          --a2ui-choicepicker-chip-background-selected,
          var(--a2ui-color-primary, #17e)
        );
        color: var(--a2ui-color-on-primary, #fff);
        border-color: var(
          --a2ui-choicepicker-chip-background-selected,
          var(--a2ui-color-primary, #17e)
        );
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChoicePickerComponent extends BasicCatalogComponent<typeof ChoicePickerApi> {
  readonly displayStyle = computed(() => this.props()['displayStyle']?.value());
  readonly options = computed(() => this.props()['options']?.value() || []);
  readonly variant = computed(() => this.props()['variant']?.value());
  readonly selectedValue = computed(() => this.props()['value']?.value());

  isMultiple(): boolean {
    return this.variant() === 'multipleSelection';
  }

  isSelected(value: string): boolean {
    const selected = this.selectedValue();
    if (Array.isArray(selected)) {
      return selected.includes(value);
    }
    return selected === value;
  }

  onCheckChange(value: string, event: Event) {
    const checked = (event.target as HTMLInputElement).checked;
    this.updateValue(value, checked);
  }

  toggleActive(value: string) {
    const current = this.isSelected(value);
    this.updateValue(value, !current);
  }

  private updateValue(value: string, active: boolean) {
    const current = this.selectedValue();
    if (this.isMultiple()) {
      let next = Array.isArray(current) ? [...current] : [];
      if (active) {
        if (!next.includes(value)) next.push(value);
      } else {
        next = next.filter((v: any) => v !== value);
      }
      this.props()['value']?.onUpdate(next);
    } else {
      if (active) {
        this.props()['value']?.onUpdate([value]);
      }
    }
  }
}
