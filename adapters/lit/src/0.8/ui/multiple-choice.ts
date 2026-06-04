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

import {html, css, PropertyValues, nothing} from 'lit';
import {customElement, property, state} from 'lit/decorators.js';
import {Root} from './root.js';
import {A2uiMessageProcessor} from '@a2ui/web_core/data/model-processor';
import * as Primitives from '@a2ui/web_core/types/primitives';
import {classMap} from 'lit/directives/class-map.js';
import {styleMap} from 'lit/directives/style-map.js';
import {structuralStyles} from './styles.js';
import {extractStringValue} from './utils/utils.js';

@customElement('a2ui-multiplechoice')
export class MultipleChoice extends Root {
  @property()
  accessor description: string | null = null;

  @property()
  accessor options: {label: Primitives.StringValue; value: string}[] = [];

  @property()
  accessor selections: Primitives.StringValue | string[] = [];

  @property()
  accessor variant: 'checkbox' | 'chips' = 'checkbox';

  @property({type: Boolean})
  accessor filterable = false;

  @state()
  accessor isOpen = false;

  @state()
  accessor filterText = '';

  static styles = [
    structuralStyles,
    css`
      * {
        box-sizing: border-box;
      }

      :host {
        display: block;
        flex: var(--weight);
        min-height: 0;
        position: relative;
        font-family: 'Google Sans', 'Roboto', sans-serif;
      }

      .container {
        display: flex;
        flex-direction: column;
        gap: 4px;
        position: relative;
      }

      /* Header / Trigger */
      .dropdown-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 16px;
        background: var(--md-sys-color-surface);
        border: 1px solid var(--md-sys-color-outline-variant);
        border-radius: 8px;
        cursor: pointer;
        user-select: none;
        transition: background-color 0.2s;
        box-shadow: var(--md-sys-elevation-level1);
      }

      .dropdown-header:hover {
        background: var(--md-sys-color-surface-container-low);
      }

      .header-text {
        font-size: 1rem;
        color: var(--md-sys-color-on-surface);
        font-weight: 400;
      }

      .chevron {
        color: var(--md-sys-color-primary);
        font-size: 1.2rem;
        transition: transform 0.2s ease;
      }

      .chevron.open {
        transform: rotate(180deg);
      }

      /* Dropdown Wrapper */
      .dropdown-wrapper {
        background: var(--md-sys-color-surface);
        border: 1px solid var(--md-sys-color-outline-variant);
        border-radius: 8px;
        box-shadow: var(--md-sys-elevation-level2);
        padding: 0;
        display: none;
        flex-direction: column;
        margin-top: 4px;
        max-height: 300px;
        transition: opacity 0.2s ease-out;
        overflow: hidden; /* contain children */
      }

      .dropdown-wrapper.open {
        display: flex;
        border: 1px solid var(--md-sys-color-outline-variant);
      }

      /* Scrollable Area for Options */
      .options-scroll-container {
        overflow-y: auto;
        flex: 1; /* take remaining height */
        display: flex;
        flex-direction: column;
      }

      /* Filter Input */
      .filter-container {
        padding: 8px;
        border-bottom: 1px solid var(--md-sys-color-outline-variant);
        background: var(--md-sys-color-surface);
        z-index: 1; /* ensure top of stack */
        flex-shrink: 0; /* don't shrink */
      }

      .filter-input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid var(--md-sys-color-outline);
        border-radius: 4px;
        font-family: inherit;
        font-size: 0.9rem;
        background: var(--md-sys-color-surface-container-low);
        color: var(--md-sys-color-on-surface);
      }

      .filter-input:focus {
        outline: none;
        border-color: var(--md-sys-color-primary);
      }

      /* Option Item (Checkbox style) */
      .option-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        cursor: pointer;
        color: var(--md-sys-color-on-surface);
        font-size: 0.95rem;
        transition: background-color 0.1s;
      }

      .option-item:hover {
        background: var(--md-sys-color-surface-container-highest);
      }

      /* Custom Checkbox */
      .checkbox {
        width: 18px;
        height: 18px;
        border: 2px solid var(--md-sys-color-outline);
        border-radius: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.2s;
        flex-shrink: 0;
      }

      .option-item.selected .checkbox {
        background: var(--md-sys-color-primary);
        border-color: var(--md-sys-color-primary);
      }

      .checkbox-icon {
        color: var(--md-sys-color-on-primary);
        font-size: 14px;
        font-weight: bold;
        opacity: 0;
        transform: scale(0.5);
        transition: all 0.2s;
      }

      .option-item.selected .checkbox-icon {
        opacity: 1;
        transform: scale(1);
      }

      /* Chips Layout */
      .chips-container {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        padding: 4px 0;
      }

      .chip {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        padding: 6px 16px;
        border: 1px solid var(--md-sys-color-outline);
        border-radius: 16px;
        cursor: pointer;
        user-select: none;
        background: var(--md-sys-color-surface);
        color: var(--md-sys-color-on-surface);
        transition: all 0.2s ease;
        font-size: 0.9rem;
      }

      .chip:hover {
        background: var(--md-sys-color-surface-container-high);
      }

      .chip.selected {
        background: var(--md-sys-color-secondary-container);
        color: var(--md-sys-color-on-secondary-container);
        border-color: var(--md-sys-color-secondary-container);
      }

      .chip.selected:hover {
        background: var(--md-sys-color-secondary-container-high);
      }

      .chip-icon {
        display: none;
        width: 18px;
        height: 18px;
      }

      .chip.selected .chip-icon {
        display: block;
        fill: currentColor;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
          transform: translateY(-8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `,
  ];

  #setBoundValue(value: string[]) {
    if (!this.selections || !this.processor) {
      return;
    }
    if (!('path' in this.selections)) {
      return;
    }
    if (!this.selections.path) {
      return;
    }

    this.processor.setData(
      this.component,
      this.selections.path,
      value,
      this.surfaceId ?? A2uiMessageProcessor.DEFAULT_SURFACE_ID,
    );
  }

  getCurrentSelections(): string[] {
    if (Array.isArray(this.selections)) {
      return this.selections;
    }

    if (!this.processor || !this.component) {
      return [];
    }

    const selectionValue = this.processor.getData(
      this.component,
      this.selections.path!,
      this.surfaceId ?? A2uiMessageProcessor.DEFAULT_SURFACE_ID,
    );

    return Array.isArray(selectionValue) ? (selectionValue as string[]) : [];
  }

  toggleSelection(value: string) {
    const current = this.getCurrentSelections();
    if (current.includes(value)) {
      this.#setBoundValue(current.filter(v => v !== value));
    } else {
      this.#setBoundValue([...current, value]);
    }
    this.requestUpdate();
  }

  #renderCheckIcon() {
    return html`
      <svg class="chip-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
        <path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z" />
      </svg>
    `;
  }

  #renderFilter() {
    return html`
      <div class="filter-container">
        <input
          type="text"
          class="filter-input"
          placeholder="Filter options..."
          .value=${this.filterText}
          @input=${(e: Event) => {
            const target = e.target as HTMLInputElement;
            this.filterText = target.value;
          }}
          @click=${(e: Event) => e.stopPropagation()}
        />
      </div>
    `;
  }

  render() {
    const currentSelections = this.getCurrentSelections();

    // Filter options
    const filteredOptions = this.options.filter(option => {
      if (!this.filterText) return true;
      const label = extractStringValue(
        option.label,
        this.component,
        this.processor,
        this.surfaceId,
      );
      return label.toLowerCase().includes(this.filterText.toLowerCase());
    });

    // Chips Layout
    if (this.variant === 'chips') {
      return html`
        <div class="container">
          ${this.description
            ? html`<div class="header-text" style="margin-bottom: 8px;">${this.description}</div>`
            : nothing}
          ${this.filterable ? this.#renderFilter() : nothing}
          <div class="chips-container">
            ${filteredOptions.map(option => {
              const label = extractStringValue(
                option.label,
                this.component,
                this.processor,
                this.surfaceId,
              );
              const isSelected = currentSelections.includes(option.value);
              return html`
                <div
                  class="chip ${isSelected ? 'selected' : ''}"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this.toggleSelection(option.value);
                  }}
                >
                  ${isSelected ? this.#renderCheckIcon() : nothing}
                  <span>${label}</span>
                </div>
              `;
            })}
          </div>
          ${filteredOptions.length === 0
            ? html`<div
                style="padding: 8px; font-style: italic; color: var(--md-sys-color-outline);"
              >
                No options found
              </div>`
            : nothing}
        </div>
      `;
    }

    // Default Checkbox Dropdown Layout
    const count = currentSelections.length;
    const headerText = count > 0 ? `${count} Selected` : (this.description ?? 'Select items');

    return html`
      <div class="container">
        <div class="dropdown-header" @click=${() => (this.isOpen = !this.isOpen)}>
          <span class="header-text">${headerText}</span>
          <span class="chevron ${this.isOpen ? 'open' : ''}">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              height="24"
              viewBox="0 -960 960 960"
              width="24"
              fill="currentColor"
            >
              <path d="M480-345 240-585l56-56 184 184 184-184 56 56-240 240Z" />
            </svg>
          </span>
        </div>

        <div class="dropdown-wrapper ${this.isOpen ? 'open' : ''}">
          ${this.filterable ? this.#renderFilter() : nothing}
          <div class="options-scroll-container">
            ${filteredOptions.map(option => {
              const label = extractStringValue(
                option.label,
                this.component,
                this.processor,
                this.surfaceId,
              );
              const isSelected = currentSelections.includes(option.value);

              return html`
                <div
                  class="option-item ${isSelected ? 'selected' : ''}"
                  @click=${(e: Event) => {
                    e.stopPropagation();
                    this.toggleSelection(option.value);
                  }}
                >
                  <div class="checkbox">
                    <span class="checkbox-icon">✓</span>
                  </div>
                  <span>${label}</span>
                </div>
              `;
            })}
            ${filteredOptions.length === 0
              ? html`<div
                  style="padding: 16px; text-align: center; color: var(--md-sys-color-outline);"
                >
                  No options found
                </div>`
              : nothing}
          </div>
        </div>
      </div>
    `;
  }
}
