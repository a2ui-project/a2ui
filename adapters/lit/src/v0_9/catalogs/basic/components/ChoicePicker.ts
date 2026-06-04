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
import {customElement, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {ChoicePickerApi} from '@a2ui/web_core/v0_9/basic_catalog';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '@a2ui/lit/v0_9';

@customElement('a2ui-choicepicker')
export class A2uiChoicePickerElement extends BasicCatalogA2uiLitElement<typeof ChoicePickerApi> {
  /**
   * The styles of the choice picker can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-choicepicker-label-color`: Color of all labels.
   * - `--a2ui-choicepicker-label-font-size`: Font size of all labels. Defaults to `--a2ui-label-font-size` then `--a2ui-font-size-s` for the main label.
   * - `--a2ui-choicepicker-label-font-weight`: Font weight of the main label. Defaults to `--a2ui-label-font-weight` then `bold`.
   * - `--a2ui-choicepicker-gap`: Spacing between options.
   * - `--a2ui-choicepicker-filter-padding`: Padding for the filter input. Defaults to `--a2ui-spacing-xs` and `--a2ui-spacing-s` (4px 8px).
   * - `--a2ui-choicepicker-chip-padding`: Padding for chips. Defaults to `--a2ui-spacing-s` and `--a2ui-spacing-m` (4px 8px).
   * - `--a2ui-choicepicker-chip-border-radius`: Border radius for chips. Defaults to `999px`.
   */
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
      padding: var(--a2ui-choicepicker-padding, 0);
    }
    .options {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
    }
    label {
      color: var(--a2ui-choicepicker-label-color, inherit);
      font-size: var(--a2ui-choicepicker-label-font-size, inherit);
    }
    :host > label {
      font-size: var(
        --a2ui-choicepicker-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(--a2ui-choicepicker-label-font-weight, var(--a2ui-label-font-weight, bold));
    }
    .filter-input {
      background-color: var(--a2ui-color-input, #fff);
      color: var(--a2ui-color-on-input, #333);
      border: var(--a2ui-textfield-border, var(--a2ui-border));
      border-radius: var(--a2ui-textfield-border-radius, var(--a2ui-spacing-m));
      padding: var(
        --a2ui-choicepicker-filter-padding,
        var(--a2ui-spacing-xs, 4px) var(--a2ui-spacing-s, 8px)
      );
      font-family: inherit;
    }
    .filter-input:focus {
      outline: none;
      border-color: var(--a2ui-textfield-color-border-focus, var(--a2ui-color-primary, #17e));
    }
    .chips {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
    }
    .chip {
      padding: var(
        --a2ui-choicepicker-chip-padding,
        var(--a2ui-spacing-s, 4px) var(--a2ui-spacing-m, 8px)
      );
      border-radius: var(--a2ui-choicepicker-chip-border-radius, 999px);
      border: 1px solid var(--a2ui-color-border, #ccc);
      background-color: var(--a2ui-color-surface, #fff);
      color: var(--a2ui-color-on-surface, inherit);
      cursor: pointer;
      font-size: var(--a2ui-font-size-xs, 0.75rem);
      font-family: inherit;
    }
    .chip.selected {
      background-color: var(--a2ui-color-primary, #007bff);
      color: var(--a2ui-color-on-primary, #fff);
      border-color: var(--a2ui-color-primary, #007bff);
    }
  `;

  @state() accessor filter = '';

  protected createController() {
    return new A2uiController(this, ChoicePickerApi);
  }

  render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const selected = Array.isArray(props.value) ? props.value : [];
    const isMulti = props.variant === 'multipleSelection';
    const isChips = props.displayStyle === 'chips';

    const toggle = (val: string) => {
      if (!props.setValue) return;
      if (isMulti) {
        if (selected.includes(val)) {
          props.setValue(selected.filter((v: string) => v !== val));
        } else {
          props.setValue([...selected, val]);
        }
      } else {
        props.setValue([val]);
      }
    };

    const options = (props.options || []).filter(
      (opt: any) =>
        !props.filterable ||
        this.filter === '' ||
        String(opt.label).toLowerCase().includes(this.filter.toLowerCase()),
    );

    return html`
      ${props.label ? html`<label>${props.label}</label>` : nothing}
      ${props.filterable
        ? html`
            <input
              type="text"
              class="filter-input"
              placeholder="Filter options..."
              aria-label="Filter options"
              .value=${this.filter}
              @input=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
            />
          `
        : nothing}
      <div class=${classMap({options: true, chips: isChips})}>
        ${options.map((opt: any) =>
          isChips
            ? html`
                <button
                  class=${classMap({
                    chip: true,
                    selected: selected.includes(opt.value),
                  })}
                  aria-pressed=${selected.includes(opt.value)}
                  @click=${() => toggle(opt.value)}
                >
                  ${opt.label}
                </button>
              `
            : html`
                <label>
                  <input
                    type=${isMulti ? 'checkbox' : 'radio'}
                    .checked=${selected.includes(opt.value)}
                    @change=${() => toggle(opt.value)}
                  />
                  ${opt.label}
                </label>
              `,
        )}
      </div>
    `;
  }
}

export const A2uiChoicePicker = {
  ...ChoicePickerApi,
  tagName: 'a2ui-choicepicker',
};
