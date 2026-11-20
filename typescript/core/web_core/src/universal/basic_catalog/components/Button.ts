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
import {classMap} from 'lit/directives/class-map.js';
import {getAccessibilityDescription, getAccessibilityLabel} from './accessibility.js';
import {BasicCatalogA2uiLitElement} from './basic-catalog-a2ui-lit-element.js';
import type {ButtonSupportedApis} from './supported_apis.js';

/**
 * A button component that can be used to trigger an action.
 */
export class A2uiBasicButtonElement extends BasicCatalogA2uiLitElement<ButtonSupportedApis> {
  /** @nocollapse */
  static readonly tagName = 'a2ui-basic-button';
  /**
   * The styles of the button can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-button-padding`: Padding of the default and `primary` variants (`borderless` forces `0`). Defaults to `--a2ui-spacing-m` vertically and `--a2ui-spacing-l` horizontally.
   * - `--a2ui-button-border-radius`: Border radius of the button. Defaults to `--a2ui-spacing-s`.
   * - `--a2ui-button-border`: Border shorthand of the default variant. Defaults to `var(--a2ui-border-width) solid var(--a2ui-color-border)`.
   * - `--a2ui-button-margin`: Outer margin of the button. Defaults to `--a2ui-spacing-m`.
   * - `--a2ui-button-background`: Background of the default variant. Defaults to `--a2ui-color-surface`.
   * - `--a2ui-button-box-shadow`: Box shadow of the button. Defaults to `none`.
   * - `--a2ui-button-font-weight`: Font weight of the button text. Defaults to `normal`.
   *
   * Global theme variables read by this component:
   *
   * - `--a2ui-color-primary`: Background of the `primary` variant and text color of the `borderless` variant.
   * - `--a2ui-color-primary-hover`: Hover background color of the `primary` variant.
   * - `--a2ui-color-on-primary`: Text color on the `primary` variant.
   * - `--a2ui-color-surface`: Fallback background color of the default variant.
   * - `--a2ui-color-secondary-hover`: Hover background color of the default variant.
   * - `--a2ui-color-on-secondary`: Text color on the default variant.
   * - `--a2ui-border-width`: Fallback border width of the default variant.
   * - `--a2ui-color-border`: Fallback border color of the default variant.
   * - `--a2ui-spacing-s`: Fallback border radius of the button.
   * - `--a2ui-spacing-m`: Fallback vertical padding and outer margin of the button.
   * - `--a2ui-spacing-l`: Fallback horizontal padding of the button.
   *
   * @nocollapse
   */
  static override styles = css`
    .a2ui-button {
      padding: var(
        --a2ui-button-padding,
        var(--a2ui-spacing-m, 0.5rem) var(--a2ui-spacing-l, 1rem)
      );
      border-radius: var(--a2ui-button-border-radius, var(--a2ui-spacing-s, 0.25rem));
      border: var(
        --a2ui-button-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      cursor: pointer;
      margin: var(--a2ui-button-margin, var(--a2ui-spacing-m, 0.5rem));
      background: var(--a2ui-button-background, var(--a2ui-color-surface, #fff));
      box-shadow: var(--a2ui-button-box-shadow, none);
      font-weight: var(--a2ui-button-font-weight, normal);
      --_a2ui-text-margin: 0;
      --_a2ui-text-color: var(--a2ui-color-on-secondary, #333);
      color: var(--_a2ui-text-color);
    }
    .a2ui-button:hover {
      background-color: var(--a2ui-color-secondary-hover, #ddd);
    }
    .a2ui-button.a2ui-button-primary {
      background: var(--a2ui-color-primary, #17e);
      --_a2ui-text-color: var(--a2ui-color-on-primary, #fff);
      color: var(--_a2ui-text-color);
      border: none;
    }
    .a2ui-button.a2ui-button-primary:hover {
      background-color: var(--a2ui-color-primary-hover, #fbd);
    }
    .a2ui-button.a2ui-button-borderless {
      background: none;
      border: none;
      padding: 0;
      color: var(--a2ui-color-primary, #17e);
    }
    .a2ui-button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }
  `;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const isDisabled = props.isValid === false;
    const variant = props.variant ?? 'default';

    const classes = {
      'a2ui-button': true,
      ['a2ui-button-' + variant]: true,
    };

    return html`
      <button
        type="button"
        class=${classMap(classes)}
        aria-label=${getAccessibilityLabel(props.accessibility)}
        aria-description=${getAccessibilityDescription(props.accessibility)}
        @click=${() => {
          if (isDisabled) return;
          props.action?.();
        }}
        ?disabled=${isDisabled}
      >
        ${props.child ? html`${this.renderNode(props.child)}` : nothing}
      </button>
    `;
  }
}
