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
import {WebComponentImplementation} from '../../catalog/types.js';

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
  static override styles = css`
    :host,
    .a2ui-choice-picker {
      display: flex;
      flex-direction: column;
      width: 100%;
      gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
      padding: var(--a2ui-choicepicker-padding, 0);
    }
    .options,
    .a2ui-options-group {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
    }
    label,
    .a2ui-option-label {
      display: flex;
      align-items: center;
      gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
      cursor: pointer;
      color: var(--a2ui-text-color-text, var(--a2ui-choicepicker-label-color, inherit));
      font-size: var(--a2ui-choicepicker-label-font-size, inherit);
    }
    :host,
    a2ui-choicepicker > label {
      font-size: var(
        --a2ui-choicepicker-label-font-size,
        var(--a2ui-label-font-size, var(--a2ui-font-size-s))
      );
      font-weight: var(--a2ui-choicepicker-label-font-weight, var(--a2ui-label-font-weight, bold));
    }
    .filter-input {
      background-color: var(--a2ui-color-input, #fff);
      color: var(--a2ui-color-on-input, #333);
      border: var(
        --a2ui-textfield-border,
        var(--a2ui-border, 1px solid var(--a2ui-color-border, #ccc))
      );
      border-radius: var(--a2ui-textfield-border-radius, var(--a2ui-spacing-m, 4px));
      padding: var(
        --a2ui-choicepicker-filter-padding,
        var(--a2ui-spacing-xs, 4px) var(--a2ui-spacing-s, 8px)
      );
      margin-bottom: var(--a2ui-choicepicker-filter-margin-bottom, var(--a2ui-spacing-s, 0.25rem));
      font-family: inherit;
    }
    .filter-input:focus {
      outline: none;
      border-color: var(--a2ui-textfield-color-border-focus, var(--a2ui-color-primary, #17e));
    }
    .a2ui-option-input {
      width: var(--a2ui-choicepicker-checkbox-size, 1rem);
      height: var(--a2ui-choicepicker-checkbox-size, 1rem);
    }
    .chips,
    .a2ui-chips-group {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      gap: var(--a2ui-choicepicker-gap, var(--a2ui-spacing-xs, 0.25rem));
    }
    .chip,
    .a2ui-chip {
      padding: var(
        --a2ui-choicepicker-chip-padding,
        var(--a2ui-spacing-s, 4px) var(--a2ui-spacing-m, 8px)
      );
      border-radius: var(--a2ui-choicepicker-chip-border-radius, 999px);
      border: var(--a2ui-choicepicker-chip-border, 1px solid var(--a2ui-color-border, #ccc));
      background-color: var(--a2ui-choicepicker-chip-background, var(--a2ui-color-surface, #fff));
      color: var(--a2ui-color-on-surface, inherit);
      cursor: pointer;
      font-size: var(--a2ui-choicepicker-chip-font-size, var(--a2ui-font-size-xs, 0.75rem));
      font-family: inherit;
      font-weight: var(--a2ui-choicepicker-chip-font-weight, normal);
      transition: all 0.2s;
    }
    .chip.selected,
    .chip.active,
    .a2ui-chip.selected,
    .a2ui-chip.active {
      background-color: var(
        --a2ui-choicepicker-chip-background-selected,
        var(--a2ui-color-primary, #007bff)
      );
      color: var(--a2ui-color-on-primary, #fff);
      border-color: var(
        --a2ui-choicepicker-chip-background-selected,
        var(--a2ui-color-primary, #007bff)
      );
    }
  `;

  @state() filter = '';

  protected readonly api = ChoicePickerApi;

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    const rawVal = props.value;
    const selected: string[] = Array.isArray(rawVal)
      ? (rawVal as string[])
      : typeof rawVal === 'string'
        ? [rawVal]
        : [];
    const isMulti = props.variant === 'multipleSelection';
    const isChips = props.displayStyle === 'chips';

    const toggle = (val: string) => {
      const setter = props.setValue;
      if (typeof setter !== 'function') return;
      if (isMulti) {
        if (selected.includes(val)) {
          setter(selected.filter((v: string) => v !== val));
        } else {
          setter([...selected, val]);
        }
      } else {
        setter([val]);
      }
    };

    const options = (props.options || []).filter(
      (opt: any) =>
        !props.filterable ||
        this.filter === '' ||
        String(opt.label).toLowerCase().includes(this.filter.toLowerCase()),
    );

    // Radio group names are document-scoped while component ids are only
    // surface-scoped, so the group name qualifies the component id with the
    // surface id and the data context path (which disambiguates instances
    // stamped from a list template within one surface).
    const surfaceId = this.context?.dataContext?.surface?.id || 'default';
    const componentId = this.context?.componentModel?.id || 'choice-picker';
    const dataPath = this.context?.dataContext?.path || '/';
    const sanitizedPath = dataPath.replace(/[^a-zA-Z0-9-]/g, '_');
    const groupName = `a2ui-choice-${surfaceId}-${componentId}-${sanitizedPath}`;

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
      <div
        class=${classMap({
          'a2ui-choice-picker': true,
          options: true,
          'a2ui-options-group': !isChips,
          chips: isChips,
          'a2ui-chips-group': isChips,
        })}
      >
        ${options.map((opt: any) =>
          isChips
            ? html`
                <button
                  type="button"
                  class=${classMap({
                    'a2ui-chip': true,
                    chip: true,
                    active: selected.includes(opt.value),
                    selected: selected.includes(opt.value),
                  })}
                  aria-pressed=${selected.includes(opt.value)}
                  @click=${() => toggle(opt.value)}
                >
                  ${opt.label}
                </button>
              `
            : html`
                <label class="a2ui-option-label">
                  <input
                    type=${isMulti ? 'checkbox' : 'radio'}
                    name=${isMulti ? nothing : groupName}
                    value=${opt.value}
                    .checked=${selected.includes(opt.value)}
                    @change=${() => toggle(opt.value)}
                    class="a2ui-option-input"
                  />
                  <span class="a2ui-option-text">${opt.label}</span>
                </label>
              `,
        )}
      </div>
    `;
  }
}

export const A2uiChoicePicker: WebComponentImplementation = {
  ...ChoicePickerApi,
  tagName: 'a2ui-choicepicker',
};
