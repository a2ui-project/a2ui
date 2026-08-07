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
import {customElement, state} from 'lit/decorators.js';
import {classMap} from 'lit/directives/class-map.js';
import {ChoicePickerApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../a2ui-controller.js';
import {WebComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-choicepicker')
export class A2uiChoicePickerElement extends BasicCatalogA2uiLitElement<typeof ChoicePickerApi> {
  static override styles = css`
    .a2ui-choice-picker {
      width: 100%;
      padding: var(--a2ui-choicepicker-padding, 0);
    }
    .filter-input {
      margin-bottom: var(--a2ui-choicepicker-filter-margin-bottom, var(--a2ui-spacing-s, 0.25rem));
      padding: var(--a2ui-choicepicker-filter-padding, var(--a2ui-spacing-s, 0.25rem));
      border: 1px solid var(--a2ui-color-border, #ccc);
      border-radius: var(--a2ui-choicepicker-filter-border-radius, 4px);
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
      font-family: inherit;
      font-size: var(--a2ui-choicepicker-chip-font-size, var(--a2ui-font-size-s, 0.833rem));
      font-weight: var(--a2ui-choicepicker-chip-font-weight, normal);
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
  `;

  @state() accessor filter = '';

  protected createController() {
    return new A2uiController(this, ChoicePickerApi);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const isMultiple = props.variant === 'multipleSelection';
    const isChips = props.displayStyle === 'chips';
    const rawOptions = Array.isArray(props.options) ? props.options : [];

    const options = rawOptions.filter(
      opt =>
        !props.filterable ||
        this.filter === '' ||
        (opt &&
          opt.label != null &&
          String(opt.label).toLowerCase().includes(this.filter.toLowerCase())),
    );

    const rawVal = props.value;
    const selected: string[] = Array.isArray(rawVal)
      ? (rawVal as string[])
      : typeof rawVal === 'string'
        ? [rawVal]
        : [];

    const updateValue = (value: string, active: boolean) => {
      const setter = props.setValue;
      if (typeof setter !== 'function') return;

      if (isMultiple) {
        let next = [...selected];
        if (active) {
          if (!next.includes(value)) next.push(value);
        } else {
          next = next.filter(v => v !== value);
        }
        setter(next);
      } else {
        if (active) {
          setter([value]);
        }
      }
    };

    const componentId = this.context?.componentModel?.id || 'choice-picker';

    return html`
      <div class="a2ui-choice-picker">
        ${isChips
          ? html`
              <div class="a2ui-chips-group">
                ${options.map(
                  option => html`
                    <button
                      type="button"
                      class=${classMap({
                        'a2ui-chip': true,
                        active: selected.includes(option.value),
                      })}
                      @click=${() => updateValue(option.value, !selected.includes(option.value))}
                    >
                      ${option.label}
                    </button>
                  `,
                )}
              </div>
            `
          : html`
              <div class="a2ui-options-group">
                ${options.map(
                  option => html`
                    <label class="a2ui-option-label">
                      <input
                        type=${isMultiple ? 'checkbox' : 'radio'}
                        name=${componentId}
                        value=${option.value}
                        .checked=${selected.includes(option.value)}
                        @change=${(e: Event) =>
                          updateValue(option.value, (e.target as HTMLInputElement).checked)}
                        class="a2ui-option-input"
                      />
                      <span class="a2ui-option-text">${option.label}</span>
                    </label>
                  `,
                )}
              </div>
            `}
      </div>
    `;
  }
}

export const A2uiChoicePicker: WebComponentImplementation = {
  ...ChoicePickerApi,
  tagName: 'a2ui-choicepicker',
};
