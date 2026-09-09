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
import {customElement} from 'lit/decorators.js';
import {SliderApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {WebComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-slider')
export class A2uiSliderElement extends BasicCatalogA2uiLitElement<typeof SliderApi> {
  /**
   * The slider can be customized with the following CSS variables:
   *
   * - `--a2ui-slider-track-color`: Color of the slider track. Defaults to `--a2ui-color-secondary`.
   * - `--a2ui-slider-thumb-color`: Color of the slider thumb. Defaults to `--a2ui-color-primary`.
   * - `--a2ui-slider-margin`: Outer margin of the component. Defaults to `--a2ui-spacing-m`.
   * - `--a2ui-slider-label-font-size`: Font size of the label. Defaults to `--a2ui-label-font-size` then `--a2ui-font-size-s`.
   * - `--a2ui-slider-label-font-weight`: Font weight of the label. Defaults to `--a2ui-label-font-weight` then `bold`.
   */
  static override styles = css`
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
  `;

  protected readonly api = SliderApi;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    return html`
      <div class="a2ui-slider-container">
        <div class="a2ui-slider-header">
          <span class="a2ui-slider-label">${props.label}</span>
          <span class="a2ui-slider-value">${props.value}</span>
        </div>
        <input
          type="range"
          min=${props.min ?? 0}
          max=${props.max ?? 100}
          .value=${props.value?.toString() || '0'}
          @input=${(e: Event) => props.setValue?.(Number((e.target as HTMLInputElement).value))}
          class="a2ui-slider"
        />
      </div>
    `;
  }
}

export const A2uiSlider: WebComponentImplementation = {
  ...SliderApi,
  tagName: 'a2ui-slider',
};
