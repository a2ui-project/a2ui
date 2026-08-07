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
import {CardApi} from './basic_components.js';
import {BasicCatalogA2uiLitElement} from '../basic-catalog-a2ui-lit-element.js';
import {A2uiController} from '../a2ui-controller.js';
import {WebComponentImplementation} from '../../catalog/types.js';

@customElement('a2ui-card')
export class A2uiCardElement extends BasicCatalogA2uiLitElement<typeof CardApi> {
  static override styles = css`
    .a2ui-card {
      padding: var(--a2ui-card-padding, var(--a2ui-spacing-m, 16px));
      border-radius: var(--a2ui-card-border-radius, var(--a2ui-border-radius, 8px));
      box-shadow: var(--a2ui-card-box-shadow, 0 2px 4px rgba(0, 0, 0, 0.1));
      background: var(--a2ui-card-background, var(--a2ui-color-surface, #fff));
      border: var(
        --a2ui-card-border,
        var(--a2ui-border-width, 1px) solid var(--a2ui-color-border, #ccc)
      );
      margin: var(--a2ui-card-margin, var(--a2ui-spacing-m, 16px));
    }
  `;

  protected createController() {
    return new A2uiController(this, CardApi);
  }

  override render() {
    const props = this.controller?.props;
    if (!props) return nothing;

    return html`
      <div class="a2ui-card">${props.child ? this.renderNode(props.child) : nothing}</div>
    `;
  }
}

export const A2uiCard: WebComponentImplementation = {
  ...CardApi,
  tagName: 'a2ui-card',
};
