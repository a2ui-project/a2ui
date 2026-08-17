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
import {classMap} from 'lit/directives/class-map.js';
import {DividerApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {createComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-divider')
export class A2uiDividerElement extends BasicCatalogA2uiLitElement<typeof DividerApi> {
  /**
   * The styles of the divider can be customized by redefining the following
   * CSS variables:
   *
   * - `--a2ui-divider-border`: The styling for the divider border. Defaults to `--a2ui-border-width` solid `--a2ui-color-border`.
   * - `--a2ui-divider-spacing`: The spacing around the divider. Defaults to `--a2ui-spacing-m`.
   */
  static override styles = css`
    .a2ui-divider {
      border: 0;
      border-top: var(
        --a2ui-divider-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      margin: var(--a2ui-divider-spacing, var(--a2ui-spacing-m, 16px)) 0;
      width: 100%;
    }
    .a2ui-divider.vertical {
      width: var(--a2ui-border-width, 1px);
      height: 100%;
      margin: 0 var(--a2ui-divider-spacing, var(--a2ui-spacing-m, 16px));
      border-top: 0;
      border-left: var(
        --a2ui-divider-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
    }
  `;

  protected readonly api = DividerApi;

  override render() {
    const props = this.controller.props;
    if (!props) return nothing;

    const axis = props.axis ?? 'horizontal';
    const classes = {
      'a2ui-divider': true,
      horizontal: axis === 'horizontal',
      vertical: axis === 'vertical',
    };

    return html`<hr class=${classMap(classes)} />`;
  }
}

export const A2uiDivider = createComponentImplementation(DividerApi, A2uiDividerElement);
