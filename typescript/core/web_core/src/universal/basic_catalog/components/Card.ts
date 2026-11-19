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
import {getAccessibilityDescription, getAccessibilityLabel} from './accessibility.js';
import {BasicCatalogA2uiLitElement} from './basic-catalog-a2ui-lit-element.js';
import type {CardSupportedApis} from './supported_apis.js';

export class A2uiCardElement extends BasicCatalogA2uiLitElement<CardSupportedApis> {
  /** @nocollapse */
  static readonly tagName = 'a2ui-card';
  /**
   * The styles of the card can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-card-padding`: Padding of the card. Defaults to `--a2ui-spacing-m`.
   * - `--a2ui-card-border-radius`: Border radius of the card. Defaults to `--a2ui-border-radius`.
   * - `--a2ui-card-box-shadow`: Box shadow of the card. Defaults to `0 2px 4px rgba(0, 0, 0, 0.1)`.
   * - `--a2ui-card-background`: Background of the card. Defaults to `--a2ui-color-surface`.
   * - `--a2ui-card-border`: Border shorthand of the card. Defaults to `var(--a2ui-border-width) solid var(--a2ui-color-border)`.
   * - `--a2ui-card-margin`: Outer margin of the card. Defaults to `--a2ui-spacing-m`.
   *
   * Global theme variables read by this component:
   *
   * - `--a2ui-color-surface`: Fallback background color of the card.
   * - `--a2ui-color-on-surface`: Text color inside the card.
   * - `--a2ui-border-radius`: Fallback border radius of the card.
   * - `--a2ui-border-width`: Fallback border width of the card.
   * - `--a2ui-color-border`: Fallback border color of the card.
   * - `--a2ui-spacing-m`: Fallback padding and outer margin of the card.
   *
   * @nocollapse
   */
  static override styles = css`
    .a2ui-card {
      padding: var(--a2ui-card-padding, var(--a2ui-spacing-m, 16px));
      border-radius: var(--a2ui-card-border-radius, var(--a2ui-border-radius, 8px));
      box-shadow: var(--a2ui-card-box-shadow, 0 2px 4px rgba(0, 0, 0, 0.1));
      background: var(--a2ui-card-background, var(--a2ui-color-surface, #fff));
      color: var(--a2ui-color-on-surface, #333);
      border: var(
        --a2ui-card-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      margin: var(--a2ui-card-margin, var(--a2ui-spacing-m, 16px));
    }
  `;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const a11yLabel = getAccessibilityLabel(props.accessibility);
    const a11yDescription = getAccessibilityDescription(props.accessibility);

    return html`
      <div
        class="a2ui-card"
        role=${a11yLabel !== nothing ? 'region' : nothing}
        aria-label=${a11yLabel}
        aria-description=${a11yDescription}
      >
        ${props.child ? this.renderNode(props.child) : nothing}
      </div>
    `;
  }
}
